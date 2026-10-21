package hdc

import "testing"

func TestIsWebViewSocketForPID(t *testing.T) {
	cases := []struct {
		socket string
		pid    string
		want   bool
	}{
		{"webview_devtools_remote_1234", "1234", true},
		{"webview_devtools_remote_12345", "1234", false},
		{"webview_devtools_remote_123", "1234", false},
		{"chrome_devtools_remote_1234", "1234", false},
		{"@webview_devtools_remote_1234", "1234", false},
	}
	for _, tc := range cases {
		if got := isWebViewSocketForPID(tc.socket, tc.pid); got != tc.want {
			t.Fatalf("isWebViewSocketForPID(%q, %q)=%v want %v", tc.socket, tc.pid, got, tc.want)
		}
	}
}

func TestCollectWebViewSocketNames(t *testing.T) {
	unixTable := `
Num       RefCount Protocol Flags    Type St Inode Path
0000000000000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_1001
0000000000000000: 00000002 00000000 00010000 0001 01 12346 @webview_devtools_remote_10012
0000000000000000: 00000002 00000000 00010000 0001 01 12347 @webview_devtools_remote_2002
`
	got := collectWebViewSocketNames(unixTable, []int{1001, 2002})
	if len(got) != 2 {
		t.Fatalf("got %v, want 2 sockets", got)
	}
}
