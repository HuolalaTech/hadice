package main

import (
	"archive/zip"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

func main() {
	source := flag.String("source", "", "directory containing Hadice.exe and its resources")
	output := flag.String("output", "", "portable ZIP path")
	flag.Parse()
	if *source == "" || *output == "" {
		fail("both -source and -output are required")
	}
	if err := createPortableZip(*source, *output); err != nil {
		fail("%v", err)
	}
	fmt.Printf("Created portable ZIP: %s\n", *output)
}

func createPortableZip(source, output string) error {
	// The archive contains one Hadice/ folder so extraction keeps the executable
	// beside bin/ and resources/. Neither the installer nor older ZIPs are included.
	required := []string{
		"Hadice.exe",
		"bin",
		"resources",
		"resources/agent/arm64-v8a/libnetwork_agent.so",
		"resources/agent/armeabi-v7a/libnetwork_agent.so",
		"LICENSE",
		"NOTICE",
		"THIRD_PARTY_NOTICE",
	}
	for _, name := range required {
		if _, err := os.Stat(filepath.Join(source, filepath.FromSlash(name))); err != nil {
			return fmt.Errorf("missing portable resource %s: %w", name, err)
		}
	}

	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(output), ".hadice-portable-*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	archive := zip.NewWriter(tmp)
	for _, name := range []string{"Hadice.exe", "bin", "resources", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICE"} {
		root := filepath.Join(source, name)
		err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(source, path)
			if err != nil {
				return err
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			header, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			header.Name = filepath.ToSlash(filepath.Join("Hadice", rel))
			header.Method = zip.Deflate
			writer, err := archive.CreateHeader(header)
			if err != nil {
				return err
			}
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(writer, file)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			return closeErr
		})
		if err != nil {
			break
		}
	}
	if closeErr := archive.Close(); err == nil {
		err = closeErr
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	// Windows cannot rename over an existing archive. Keep the old one until the
	// replacement has been built successfully.
	if err := os.Remove(output); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmp.Name(), output)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
