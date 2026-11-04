package phoneAgent

import (
	"reflect"
	"testing"
)

func TestChatCompletionsURL(t *testing.T) {
	cases := []struct {
		provider LLMProvider
		baseURL  string
		want     string
	}{
		{ProviderDeepSeek, "", "https://api.deepseek.com/chat/completions"},
		{ProviderDeepSeek, "https://api.deepseek.com/v1", "https://api.deepseek.com/v1/chat/completions"},
		{ProviderZhipuAI, "", "https://open.bigmodel.cn/api/paas/v4/chat/completions"},
		{ProviderOpenAI, "https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions"},
		{ProviderCustom, "https://api.siliconflow.cn/v1/chat/completions", "https://api.siliconflow.cn/v1/chat/completions"},
		{ProviderOpenRouter, "", "https://openrouter.ai/api/v1/chat/completions"},
	}
	for _, c := range cases {
		got := chatCompletionsURL(c.provider, c.baseURL)
		if got != c.want {
			t.Fatalf("%s %q => %s, want %s", c.provider, c.baseURL, got, c.want)
		}
	}
}

func TestModelsURL(t *testing.T) {
	got := modelsURL(ProviderDeepSeek, "")
	want := "https://api.deepseek.com/models"
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestParseModelIDs(t *testing.T) {
	ids := parseModelIDs([]byte(`{"data":[{"id":"deepseek-chat"},{"id":"deepseek-v4-flash-vision-exp"}]}`))
	want := []string{"deepseek-chat", "deepseek-v4-flash-vision-exp"}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("got %#v", ids)
	}
}
