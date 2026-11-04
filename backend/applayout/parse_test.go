package applayout

import (
	"testing"
)

func TestParseBounds(t *testing.T) {
	b := parseBounds("[10,20][110,220]")
	if b.Left != 10 || b.Top != 20 || b.Right != 110 || b.Bottom != 220 {
		t.Fatalf("unexpected bounds: %+v", b)
	}
}

func TestParseHarmonyJSON(t *testing.T) {
	raw := []byte(`{
		"attributes": {"type": "root", "bounds": "[0,0][100,200]", "bundleName": "demo"},
		"children": [
			{"attributes": {"type": "Button", "text": "确定", "id": "btn_ok", "bounds": "[10,10][90,50]", "clickable": "true"}, "children": []}
		]
	}`)
	root, err := parseHarmonyJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if root.Type != "root" || countNodes(root) != 2 {
		t.Fatalf("root=%+v count=%d", root, countNodes(root))
	}
	if len(root.Children) != 1 || root.Children[0].Text != "确定" || !root.Children[0].Clickable {
		t.Fatalf("child=%+v", root.Children[0])
	}
}

func TestParseAndroidXML(t *testing.T) {
	raw := []byte(`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node bounds="[0,0][1080,1920]" class="android.widget.FrameLayout" clickable="false" content-desc="" package="com.demo" resource-id="" text="">
    <node bounds="[100,200][300,280]" class="android.widget.TextView" clickable="true" content-desc="title" package="com.demo" resource-id="com.demo:id/tv" text="Hello"/>
  </node>
</hierarchy>`)
	root, err := parseAndroidXML(raw)
	if err != nil {
		t.Fatal(err)
	}
	if root.Type != "android.widget.FrameLayout" || countNodes(root) != 2 {
		t.Fatalf("root=%+v count=%d", root, countNodes(root))
	}
	child := root.Children[0]
	if child.Text != "Hello" || child.ResourceID != "com.demo:id/tv" || child.Bounds.Left != 100 {
		t.Fatalf("child=%+v", child)
	}
}
