package scrcpy

import (
	"encoding/binary"
	"fmt"
)

// h264UnescapeRBSP removes emulation prevention bytes (0x03 after 0x00 0x00)
// from NAL payload (bytes after the NAL header byte).
func h264UnescapeRBSP(nalu []byte) []byte {
	if len(nalu) <= 1 {
		return nil
	}
	payload := nalu[1:]
	out := make([]byte, 0, len(payload))
	for i := 0; i < len(payload); i++ {
		if i+2 < len(payload) && payload[i] == 0 && payload[i+1] == 0 && payload[i+2] == 0x03 {
			out = append(out, 0, 0)
			i += 2
			continue
		}
		out = append(out, payload[i])
	}
	return out
}

type h264BitReader struct {
	data []byte
	pos  int
}

func (r *h264BitReader) readBit() uint32 {
	if r.pos >= len(r.data)*8 {
		return 0
	}
	byteIdx := r.pos / 8
	bitIdx := 7 - (r.pos % 8)
	r.pos++
	return uint32((r.data[byteIdx] >> bitIdx) & 1)
}

func (r *h264BitReader) readBits(n int) uint32 {
	var v uint32
	for i := 0; i < n; i++ {
		v = (v << 1) | r.readBit()
	}
	return v
}

// readUE parses unsigned exp-Golomb (H.264 9.1).
func (r *h264BitReader) readUE() uint32 {
	k := 0
	for r.readBit() == 0 {
		k++
		if k > 31 {
			return 0
		}
	}
	return uint32(1<<k-1) + r.readBits(k)
}

// nalUnitIndicatesKeyframe returns true for IDR (NAL 5) or non-IDR coded slice (NAL 1)
// whose slice header reports an I or SI slice (slice_type % 5 in {2,4}).
// This matches WebCodecs needing EncodedVideoChunk type "key" for intra refreshes
// that are not NAL type 5 on some Android encoders.
func nalUnitIndicatesKeyframe(nalu []byte) bool {
	if len(nalu) < 2 {
		return false
	}
	nalType := nalu[0] & 0x1F
	if nalType == 5 {
		return true
	}
	if nalType != 1 {
		return false
	}
	rbsp := h264UnescapeRBSP(nalu)
	if len(rbsp) < 1 {
		return false
	}
	br := &h264BitReader{data: rbsp, pos: 0}
	_ = br.readUE() // first_mb_in_slice
	sliceType := br.readUE()
	// Table 7-6: I=2, SI=4; same mod 5 for 7,9 (no deblocking filter control)
	st := sliceType % 5
	return st == 2 || st == 4
}

// ParseAnnexBNALUnits extracts individual NAL units from an Annex B byte stream,
// stripping start codes (00 00 01 or 00 00 00 01).
func ParseAnnexBNALUnits(data []byte) [][]byte {
	var nalUnits [][]byte
	i := 0
	n := len(data)

	for i < n {
		scPos, scLen := findStartCode(data, i, n)
		if scPos < 0 {
			break
		}
		naluStart := scPos + scLen

		nextPos, _ := findStartCode(data, naluStart, n)
		var naluEnd int
		if nextPos < 0 {
			naluEnd = n
		} else {
			naluEnd = nextPos
		}

		if naluEnd > naluStart {
			nalu := make([]byte, naluEnd-naluStart)
			copy(nalu, data[naluStart:naluEnd])
			nalUnits = append(nalUnits, nalu)
		}

		if nextPos < 0 {
			break
		}
		i = nextPos
	}

	return nalUnits
}

// findStartCode scans data[offset:limit] for the next Annex B start code.
// Returns (position, length) or (-1, 0) if not found.
func findStartCode(data []byte, offset, limit int) (int, int) {
	for i := offset; i+2 < limit; i++ {
		if data[i] == 0 && data[i+1] == 0 {
			if data[i+2] == 1 {
				return i, 3
			}
			if i+3 < limit && data[i+2] == 0 && data[i+3] == 1 {
				return i, 4
			}
		}
	}
	return -1, 0
}

// AnnexBToAVCC converts an Annex B formatted H.264 frame to AVCC format
// (4-byte big-endian length prefix per NAL unit).
// Returns the converted data and whether the access unit should be treated as a
// key frame for WebCodecs: IDR (NAL type 5) or non-IDR I/SI slice (NAL type 1 with
// slice_type % 5 in {2,4}).
func AnnexBToAVCC(data []byte) ([]byte, bool) {
	nalUnits := ParseAnnexBNALUnits(data)
	if len(nalUnits) == 0 {
		return data, false
	}

	isKeyframe := false
	for _, nalu := range nalUnits {
		if nalUnitIndicatesKeyframe(nalu) {
			isKeyframe = true
			break
		}
	}

	totalSize := 0
	for _, nalu := range nalUnits {
		totalSize += 4 + len(nalu)
	}

	result := make([]byte, totalSize)
	offset := 0
	for _, nalu := range nalUnits {
		binary.BigEndian.PutUint32(result[offset:offset+4], uint32(len(nalu)))
		copy(result[offset+4:], nalu)
		offset += 4 + len(nalu)
	}

	return result, isKeyframe
}

// BuildAVCDecoderConfigRecord builds an AVCDecoderConfigurationRecord from
// an Annex B config packet containing SPS and PPS NAL units.
// The record is suitable for use as the "description" field in WebCodecs VideoDecoderConfig.
func BuildAVCDecoderConfigRecord(configData []byte) ([]byte, error) {
	nalUnits := ParseAnnexBNALUnits(configData)

	var sps, pps []byte
	for _, nalu := range nalUnits {
		if len(nalu) == 0 {
			continue
		}
		nalType := nalu[0] & 0x1F
		switch nalType {
		case 7:
			if sps == nil {
				sps = nalu
			}
		case 8:
			if pps == nil {
				pps = nalu
			}
		}
	}

	if sps == nil {
		return nil, fmt.Errorf("SPS not found in config data")
	}
	if pps == nil {
		return nil, fmt.Errorf("PPS not found in config data")
	}
	if len(sps) < 4 {
		return nil, fmt.Errorf("SPS too short: %d bytes", len(sps))
	}

	// AVCDecoderConfigurationRecord layout:
	// [0]    configurationVersion = 1
	// [1]    AVCProfileIndication = sps[1]
	// [2]    profile_compatibility = sps[2]
	// [3]    AVCLevelIndication = sps[3]
	// [4]    0xFC | lengthSizeMinusOne(3) = 0xFF
	// [5]    0xE0 | numOfSPS(1) = 0xE1
	// [6..7] spsLength (big-endian uint16)
	// [8..8+spsLen-1] spsData
	// [next]  numOfPPS = 1
	// [+1,+2] ppsLength (big-endian uint16)
	// [+3..+3+ppsLen-1] ppsData
	recordLen := 6 + 2 + len(sps) + 1 + 2 + len(pps)
	record := make([]byte, recordLen)

	record[0] = 1          // configurationVersion
	record[1] = sps[1]     // AVCProfileIndication
	record[2] = sps[2]     // profile_compatibility
	record[3] = sps[3]     // AVCLevelIndication
	record[4] = 0xFF       // reserved(6 bits, all 1) + lengthSizeMinusOne(3)
	record[5] = 0xE1       // reserved(3 bits, all 1) + numOfSPS(1)
	binary.BigEndian.PutUint16(record[6:8], uint16(len(sps)))
	copy(record[8:], sps)

	off := 8 + len(sps)
	record[off] = 1 // numOfPPS
	binary.BigEndian.PutUint16(record[off+1:off+3], uint16(len(pps)))
	copy(record[off+3:], pps)

	return record, nil
}
