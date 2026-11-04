package applayout

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var boundsRe = regexp.MustCompile(`\[(\d+),(\d+)\]\[(\d+),(\d+)\]`)

func parseBounds(s string) Bounds {
	m := boundsRe.FindStringSubmatch(strings.TrimSpace(s))
	if len(m) != 5 {
		return Bounds{}
	}
	l, _ := strconv.Atoi(m[1])
	t, _ := strconv.Atoi(m[2])
	r, _ := strconv.Atoi(m[3])
	b, _ := strconv.Atoi(m[4])
	return Bounds{Left: l, Top: t, Right: r, Bottom: b}
}

func countNodes(n *Node) int {
	if n == nil {
		return 0
	}
	c := 1
	for _, ch := range n.Children {
		c += countNodes(ch)
	}
	return c
}

// --- HarmonyOS dumpLayout JSON ---

type harmonyNode struct {
	Attributes map[string]interface{} `json:"attributes"`
	Children   []harmonyNode          `json:"children"`
}

func parseHarmonyJSON(data []byte) (*Node, error) {
	var root harmonyNode
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("解析鸿蒙布局 JSON 失败: %w", err)
	}
	return convertHarmonyNode(&root, "0"), nil
}

func attrStr(attrs map[string]interface{}, keys ...string) string {
	if attrs == nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := attrs[k]; ok && v != nil {
			switch t := v.(type) {
			case string:
				return t
			case float64:
				return strconv.FormatFloat(t, 'f', -1, 64)
			case bool:
				return strconv.FormatBool(t)
			default:
				return fmt.Sprint(t)
			}
		}
	}
	return ""
}

func attrBool(attrs map[string]interface{}, keys ...string) bool {
	s := strings.ToLower(attrStr(attrs, keys...))
	return s == "true" || s == "1"
}

func convertHarmonyNode(n *harmonyNode, path string) *Node {
	if n == nil {
		return nil
	}
	attrs := n.Attributes
	node := &Node{
		ID:         path,
		Type:       firstNonEmpty(attrStr(attrs, "type", "typeName", "componentType"), "View"),
		Text:       attrStr(attrs, "text", "value"),
		ResourceID: attrStr(attrs, "id", "key"),
		Desc:       attrStr(attrs, "description", "hint", "accessibilityText"),
		Clickable:  attrBool(attrs, "clickable"),
		Bounds:     parseBounds(attrStr(attrs, "bounds", "bound")),
		Children:   make([]*Node, 0, len(n.Children)),
	}
	for i := range n.Children {
		ch := convertHarmonyNode(&n.Children[i], fmt.Sprintf("%s.%d", path, i))
		if ch != nil {
			node.Children = append(node.Children, ch)
		}
	}
	return node
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// --- Android uiautomator XML ---

type androidNode struct {
	XMLName     xml.Name      `xml:"node"`
	Index       string        `xml:"index,attr"`
	Text        string        `xml:"text,attr"`
	ResourceID  string        `xml:"resource-id,attr"`
	Class       string        `xml:"class,attr"`
	Package     string        `xml:"package,attr"`
	ContentDesc string        `xml:"content-desc,attr"`
	Clickable   string        `xml:"clickable,attr"`
	Bounds      string        `xml:"bounds,attr"`
	Children    []androidNode `xml:"node"`
}

type androidHierarchy struct {
	XMLName xml.Name    `xml:"hierarchy"`
	Nodes   []androidNode `xml:"node"`
}

func parseAndroidXML(data []byte) (*Node, error) {
	trimmed := bytesTrimBOM(data)
	var hier androidHierarchy
	if err := xml.Unmarshal(trimmed, &hier); err != nil {
		// 有些 dump 顶层就是 <node>
		var single androidNode
		if err2 := xml.Unmarshal(trimmed, &single); err2 != nil {
			return nil, fmt.Errorf("解析安卓布局 XML 失败: %w", err)
		}
		return convertAndroidNode(&single, "0"), nil
	}
	if len(hier.Nodes) == 0 {
		return nil, fmt.Errorf("安卓布局树为空")
	}
	if len(hier.Nodes) == 1 {
		return convertAndroidNode(&hier.Nodes[0], "0"), nil
	}
	root := &Node{
		ID:       "0",
		Type:     "hierarchy",
		Children: make([]*Node, 0, len(hier.Nodes)),
	}
	for i := range hier.Nodes {
		ch := convertAndroidNode(&hier.Nodes[i], fmt.Sprintf("0.%d", i))
		if ch != nil {
			root.Children = append(root.Children, ch)
		}
	}
	return root, nil
}

func convertAndroidNode(n *androidNode, path string) *Node {
	if n == nil {
		return nil
	}
	typ := n.Class
	if typ == "" {
		typ = "View"
	}
	node := &Node{
		ID:         path,
		Type:       typ,
		Text:       n.Text,
		ResourceID: n.ResourceID,
		Desc:       n.ContentDesc,
		Clickable:  strings.EqualFold(n.Clickable, "true"),
		Bounds:     parseBounds(n.Bounds),
		Children:   make([]*Node, 0, len(n.Children)),
	}
	for i := range n.Children {
		ch := convertAndroidNode(&n.Children[i], fmt.Sprintf("%s.%d", path, i))
		if ch != nil {
			node.Children = append(node.Children, ch)
		}
	}
	return node
}

func bytesTrimBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}
