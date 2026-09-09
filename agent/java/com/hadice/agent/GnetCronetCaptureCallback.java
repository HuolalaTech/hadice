package com.hadice.agent;

import gnet.android.org.chromium.net.CronetException;
import gnet.android.org.chromium.net.ExperimentalUrlRequest;
import gnet.android.org.chromium.net.UrlRequest;
import gnet.android.org.chromium.net.UrlResponseInfo;
import java.io.ByteArrayOutputStream;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.Collections;
import java.nio.ByteBuffer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import org.json.JSONObject;

/** Forwards gnet Cronet callbacks while recording the observable response lifecycle. */
public final class GnetCronetCaptureCallback extends UrlRequest.Callback {
    private final int id;
    private final UrlRequest.Callback delegate;
    private final Executor executor;
    private String url;
    private int status;
    private Map<String, String> headers = new LinkedHashMap<>();
    private final ByteArrayOutputStream body = new ByteArrayOutputStream();
    private boolean requestSent;
    private boolean responseSent;
    private String method = "GET";

    GnetCronetCaptureCallback(String initialUrl, UrlRequest.Callback delegate, Executor executor) {
        this.id = NetworkHookHelper.nextCaptureRequestId();
        this.url = initialUrl;
        this.delegate = delegate;
        this.executor = executor;
        NetworkHookHelper.registerGnetCronetCallback(this);
    }

    void setRequestMethod(String requestMethod) {
        if (requestMethod != null && requestMethod.length() > 0) method = requestMethod;
    }

    void setRequestHeader(String name, String value) {
        if (name != null && value != null) headers.put(name, value);
    }

    Object createMockRequest() {
        if (executor == null) {
            NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_missing_executor", "url=" + url);
            android.util.Log.w("NetworkHookHelper", "gnet Cronet Mock skipped: executor is missing, url=" + url);
            return null;
        }
        JSONObject rule = NetworkHookHelper.findGnetMockRule(method, url, headers);
        if (rule == null || !"replace".equals(rule.optString("responseMode", "replace"))) {
            return null;
        }
        JSONObject condition = rule.optJSONObject("matchCondition");
        if (condition != null && condition.optString("bodyPattern", "").length() > 0) {
            NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_skipped",
                "bodyPattern requires request body; url=" + url);
            return null;
        }
        try {
            NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_matched",
                rule.optString("name", rule.optString("id", "")) + " url=" + url);
            android.util.Log.i("NetworkHookHelper", "gnet Cronet Mock matched: url=" + url);
            return new MockGnetUrlRequest(id, method, url, headers,
                (UrlRequest.Callback) delegate, executor, NetworkHookHelper.MockResponseSpec.fromRule(rule), rule);
        } catch (Throwable error) {
            NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_create_failed",
                String.valueOf(error.getMessage()));
            return null;
        }
    }

    @Override public void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String location) {
        if (location != null) url = location;
        delegate.onRedirectReceived(request, info, location);
    }
    @Override public void onResponseStarted(UrlRequest request, UrlResponseInfo info) {
        capture(info); sendRequest(); delegate.onResponseStarted(request, info);
    }
    @Override public void onReadCompleted(UrlRequest request, UrlResponseInfo info, ByteBuffer buffer) {
        capture(info);
        try {
            ByteBuffer copy = buffer.duplicate();
            int length = Math.min(copy.position(), 1024 * 1024 - body.size());
            if (length > 0) {
                copy.position(0); copy.limit(length);
                byte[] bytes = new byte[length]; copy.get(bytes); body.write(bytes);
            }
        } catch (Throwable ignored) {}
        delegate.onReadCompleted(request, info, buffer);
    }
    @Override public void onSucceeded(UrlRequest request, UrlResponseInfo info) {
        capture(info); sendRequest(); try { delegate.onSucceeded(request, info); } finally { sendResponse(); }
    }
    @Override public void onFailed(UrlRequest request, UrlResponseInfo info, CronetException error) {
        capture(info); sendRequest(); try { delegate.onFailed(request, info, error); } finally { sendResponse(); }
    }
    @Override public void onCanceled(UrlRequest request, UrlResponseInfo info) {
        capture(info); sendRequest(); try { delegate.onCanceled(request, info); } finally { sendResponse(); }
    }
    private void capture(UrlResponseInfo info) {
        if (info == null) return;
        try {
            status = info.getHttpStatusCode(); if (info.getUrl() != null) url = info.getUrl();
            for (Map.Entry<String, List<String>> entry : info.getAllHeaders().entrySet()) {
                headers.put(entry.getKey(), entry.getValue().toString());
            }
        } catch (Throwable ignored) {}
    }
    private void sendRequest() {
        if (!requestSent) {
            requestSent = true;
            NetworkHookHelper.sendGnetRequest(id, method, url, headers);
        }
    }
    private void sendResponse() {
        if (!responseSent) {
            responseSent = true;
            NetworkHookHelper.sendGnetResponse(id, url, status, headers, body.toByteArray());
        }
    }

    /** A gnet-specific Request replacement that never reaches the network stack. */
    // ExperimentalUrlRequest is a UrlRequest subtype, so this replacement can
    // safely satisfy both normal and covariant ExperimentalUrlRequest build() paths.
    private static final class MockGnetUrlRequest extends ExperimentalUrlRequest {
        private final int id;
        private final String method;
        private final String url;
        private final Map<String, String> requestHeaders;
        private final UrlRequest.Callback callback;
        private final Executor executor;
        private final NetworkHookHelper.MockResponseSpec response;
        private final JSONObject rule;
        private final UrlResponseInfo responseInfo;
        private int offset;
        private boolean started;
        private boolean done;
        private boolean canceled;
        private boolean requestReported;
        private boolean responseReported;

        MockGnetUrlRequest(int id, String method, String url, Map<String, String> requestHeaders,
                            UrlRequest.Callback callback, Executor executor,
                            NetworkHookHelper.MockResponseSpec response, JSONObject rule) {
            this.id = id;
            this.method = method;
            this.url = url;
            this.requestHeaders = new LinkedHashMap<>(requestHeaders);
            this.callback = callback;
            this.executor = executor;
            this.response = response;
            this.rule = rule;
            this.responseInfo = new MockGnetUrlResponseInfo(url, response);
        }

        @Override public void start() {
            synchronized (this) {
                if (started || done) return;
                started = true;
                if (!requestReported) {
                    requestReported = true;
                    NetworkHookHelper.sendGnetRequest(id, method, url, requestHeaders);
                }
            }
            execute(new Runnable() {
                @Override public void run() {
                    synchronized (MockGnetUrlRequest.this) {
                        if (done || canceled) return;
                    }
                    try {
                        callback.onResponseStarted(MockGnetUrlRequest.this, responseInfo);
                    } catch (Throwable error) {
                        failCallback("onResponseStarted", error);
                    }
                }
            });
        }

        @Override public void read(final ByteBuffer buffer) {
            if (buffer == null) {
                NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_read_failed", "response buffer is null");
                return;
            }
            boolean complete = false;
            synchronized (this) {
                if (!started || done || canceled) return;
                if (offset >= response.body.length) {
                    done = true;
                    if (!responseReported) {
                        responseReported = true;
                        complete = true;
                    }
                } else {
                    int count = Math.min(buffer.remaining(), response.body.length - offset);
                    if (count <= 0) {
                        NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_read_failed",
                            "response buffer has no remaining capacity");
                        throw new IllegalArgumentException("gnet Cronet Mock response buffer has no remaining capacity");
                    }
                    buffer.put(response.body, offset, count);
                    offset += count;
                }
            }
            if (complete) {
                reportResponse();
                execute(new Runnable() {
                    @Override public void run() {
                        try {
                            callback.onSucceeded(MockGnetUrlRequest.this, responseInfo);
                        } catch (Throwable error) {
                            failCallback("onSucceeded", error);
                        }
                    }
                });
                return;
            }
            execute(new Runnable() {
                @Override public void run() {
                    synchronized (MockGnetUrlRequest.this) {
                        if (done || canceled) return;
                    }
                    try {
                        callback.onReadCompleted(MockGnetUrlRequest.this, responseInfo, buffer);
                    } catch (Throwable error) {
                        failCallback("onReadCompleted", error);
                    }
                }
            });
        }

        @Override public void cancel() {
            synchronized (this) {
                if (done || canceled) return;
                canceled = true;
                done = true;
            }
            execute(new Runnable() {
                @Override public void run() {
                    try {
                        callback.onCanceled(MockGnetUrlRequest.this, responseInfo);
                    } catch (Throwable error) {
                        failCallback("onCanceled", error);
                    }
                }
            });
        }

        @Override public synchronized boolean isDone() { return done; }

        @Override public void getStatus(final StatusListener listener) {
            if (listener == null) return;
            execute(new Runnable() {
                @Override public void run() { listener.onStatus(isDone() ? 0 : 14); }
            });
        }

        private void reportResponse() {
            NetworkHookHelper.sendGnetResponse(id, method, url, response, rule);
        }

        private void execute(Runnable task) {
            try {
                executor.execute(task);
            } catch (Throwable error) {
                synchronized (this) {
                    done = true;
                }
                NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_executor_failed",
                    String.valueOf(error.getMessage()));
            }
        }

        private void failCallback(String phase, Throwable error) {
            synchronized (this) {
                done = true;
            }
            NetworkHookHelper.sendGnetMockDebug("gnet_cronet_mock_callback_failed",
                phase + ": " + String.valueOf(error));
            android.util.Log.e("NetworkHookHelper", "gnet Cronet Mock callback failed in " + phase, error);
        }
    }

    private static final class MockGnetUrlResponseInfo extends UrlResponseInfo {
        private final String url;
        private final NetworkHookHelper.MockResponseSpec response;
        private final Map<String, List<String>> headerMap;
        private final List<Map.Entry<String, String>> headerList;

        MockGnetUrlResponseInfo(String url, NetworkHookHelper.MockResponseSpec response) {
            this.url = url;
            this.response = response;
            Map<String, List<String>> mapped = new LinkedHashMap<>();
            List<Map.Entry<String, String>> entries = new ArrayList<>();
            for (Map.Entry<String, String> entry : response.headers.entrySet()) {
                mapped.put(entry.getKey(), Collections.singletonList(entry.getValue()));
                entries.add(new AbstractMap.SimpleImmutableEntry<>(entry.getKey(), entry.getValue()));
            }
            headerMap = Collections.unmodifiableMap(mapped);
            headerList = Collections.unmodifiableList(entries);
        }

        @Override public int getHttpStatusCode() { return response.statusCode; }
        @Override public String getHttpStatusText() { return response.statusText; }
        @Override public Map<String, List<String>> getAllHeaders() { return headerMap; }
        @Override public List<Map.Entry<String, String>> getAllHeadersAsList() { return headerList; }
        @Override public String getUrl() { return url; }
        @Override public List<String> getUrlChain() { return Collections.singletonList(url); }
        @Override public boolean wasCached() { return false; }
        @Override public String getNegotiatedProtocol() { return "http/1.1"; }
        @Override public String getProtocolName() { return "http/1.1"; }
        @Override public String getProxyServer() { return ""; }
        @Override public long getReceivedByteCount() { return response.body.length; }
        @Override public boolean isProxy() { return false; }
    }
}
