package backend

import "testing"

func TestPanelWindowURLIncludesDevice(t *testing.T) {
	got := panelWindowURL("app-layout", "mate60")
	want := "/?device=mate60&page=app-layout&standalone=1"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPanelWindowURLOmitsEmptyDevice(t *testing.T) {
	got := panelWindowURL("app-layout", "")
	want := "/?page=app-layout&standalone=1"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
