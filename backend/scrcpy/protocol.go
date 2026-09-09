package scrcpy

import "fmt"

const ServerVersion = "3.3.4"

const (
	ControlTypeInjectKeycode     = 0
	ControlTypeInjectText        = 1
	ControlTypeInjectTouchEvent  = 2
	ControlTypeInjectScrollEvent = 3
	ControlTypeBackOrScreenOn    = 4
	ControlTypeExpandPanel       = 5
	ControlTypeCollapsePanel     = 6
	ControlTypeGetClipboard      = 7
	ControlTypeSetClipboard      = 8
	ControlTypeRotateDevice      = 9
)

const (
	ActionDown   = 0
	ActionUp     = 1
	ActionMove   = 2
	ActionCancel = 3
)

const (
	CodecH264 = 0
	CodecH265 = 1
	CodecAV1  = 2
)

type FrameHeader struct {
	ConfigPacket bool
	KeyFrame     bool
	PTS          int64
	PacketSize   uint32
}

type CodecMetadata struct {
	CodecID uint32
	Width   uint32
	Height  uint32
}

type Options struct {
	MaxSize       int
	MaxFPS        int
	VideoCodec    string
	TunnelForward bool
	Audio         bool
	Control       bool
	// KeyFrameInterval is a target GOP in frames (0 = omit option, encoder default).
	// Android MediaCodec maps this via scrcpy to KEY_I_FRAME_INTERVAL, which is
	// specified in **seconds**, not frame count — so we convert using MaxFPS:
	// seconds = KeyFrameInterval / MaxFPS (e.g. 10 frames @ 60fps -> 0.1667s).
	KeyFrameInterval int
}

func DefaultOptions() Options {
	return Options{
		MaxSize:          1920,
		MaxFPS:           60,
		VideoCodec:       "h264",
		TunnelForward:    true,
		Audio:            false,
		Control:          true,
		KeyFrameInterval: 10, // ~every 10 frames at MaxFPS (not 10 seconds)
	}
}

func (o Options) ToServerArgs(scid int64) []string {
	args := []string{
		ServerVersion,
		fmt.Sprintf("scid=%x", scid),
		"max_size=" + intToStr(o.MaxSize),
		"max_fps=" + intToStr(o.MaxFPS),
		"video_codec=" + o.VideoCodec,
		"tunnel_forward=true",
		"audio=false",
		"control=true",
		"send_device_meta=true",
		"send_frame_meta=true",
		"send_codec_meta=true",
		"send_dummy_byte=true",
		"cleanup=true",
		"log_level=info",
	}
	// scrcpy 3.3.x: video_codec_options. Android KEY_I_FRAME_INTERVAL is in seconds,
	// so convert KeyFrameInterval (frames) using MaxFPS.
	if o.KeyFrameInterval > 0 {
		maxFps := o.MaxFPS
		if maxFps <= 0 {
			maxFps = 60
		}
		sec := float64(o.KeyFrameInterval) / float64(maxFps)
		args = append(args, fmt.Sprintf("video_codec_options=i-frame-interval:float=%.4f", sec))
	}
	return args
}

func intToStr(n int) string {
	if n <= 0 {
		return "0"
	}
	return int64ToStr(int64(n))
}

func int64ToStr(n int64) string {
	if n == 0 {
		return "0"
	}
	var negative bool
	if n < 0 {
		negative = true
		n = -n
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if negative {
		digits = append([]byte{'-'}, digits...)
	}
	return string(digits)
}
