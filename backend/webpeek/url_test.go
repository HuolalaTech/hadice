package webpeek

import "testing"

func TestNormalizeURL(t *testing.T) {
	got, err := NormalizeURL("www.163.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://www.163.com" && got != "https://www.163.com/" {
		// url.String() may or may not add trailing slash depending on path
		if !stringsHasPrefix(got, "https://www.163.com") {
			t.Fatalf("got %q", got)
		}
	}
	if _, err := NormalizeURL("javascript:alert(1)"); err == nil {
		t.Fatal("expected error")
	}
}

func stringsHasPrefix(s, p string) bool {
	return len(s) >= len(p) && s[:len(p)] == p
}
