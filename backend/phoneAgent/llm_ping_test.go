package phoneAgent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLLMClientPing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("auth = %s", got)
		}
		var body LLMRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "deepseek-v4-flash-vision-exp" || body.Stream {
			t.Fatalf("body = %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"content":"pong"}}]}`))
	}))
	defer server.Close()

	client := NewLLMClient(LLMConfig{
		Provider: ProviderCustom,
		APIKey:   "test-key",
		BaseURL:  server.URL,
		Model:    "deepseek-v4-flash-vision-exp",
	})
	if err := client.Ping(); err != nil {
		t.Fatal(err)
	}
}

func TestLLMClientPingUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer server.Close()

	client := NewLLMClient(LLMConfig{
		Provider: ProviderCustom,
		APIKey:   "bad",
		BaseURL:  server.URL,
		Model:    "m",
	})
	err := client.Ping()
	if err == nil || !strings.Contains(err.Error(), "invalid api key") {
		t.Fatalf("got %v", err)
	}
}

func TestLLMClientListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/models" {
			t.Fatalf("%s %s", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"data":[{"id":"deepseek-v4-flash-vision-exp"},{"id":"deepseek-chat"}]}`))
	}))
	defer server.Close()

	client := NewLLMClient(LLMConfig{
		Provider: ProviderCustom,
		APIKey:   "test-key",
		BaseURL:  server.URL,
	})
	ids, err := client.ListModels()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != "deepseek-v4-flash-vision-exp" {
		t.Fatalf("got %#v", ids)
	}
}

func TestLLMClientPingRequiresKey(t *testing.T) {
	client := NewLLMClient(LLMConfig{Model: "m"})
	err := client.Ping()
	if err == nil || !strings.Contains(err.Error(), "API密钥") {
		t.Fatalf("got %v", err)
	}
}
