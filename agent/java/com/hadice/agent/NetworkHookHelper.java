package com.hadice.agent;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.AbstractMap;
import java.util.Arrays;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import java.util.WeakHashMap;
import org.chromium.net.CronetException;
import org.chromium.net.UploadDataProvider;
import org.chromium.net.UploadDataSink;
import org.chromium.net.UrlRequest;
import org.chromium.net.UrlResponseInfo;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Network traffic capture helper injected via JVMTI.
 * Uses OkHttp Interceptor injection via reflection.
 */
public class NetworkHookHelper {
    private static final String TAG = "NetworkHookHelper";
    private static final AtomicInteger requestIdCounter = new AtomicInteger(0);
    private static final AtomicInteger mockDebugCounter = new AtomicInteger(0);
    private static final int CRONET_MAX_BODY_BYTES = 1024 * 1024;
    private static final Set<Integer> injectedClients = new HashSet<>();
    private static Object cachedInterceptor = null;
    private static volatile JSONObject mockConfig = null;

    /** JNI bridge */
    private static native void nativeSendMessage(String message);

    public static void enableWebViewDebugging() {
        try {
            android.webkit.WebView.setWebContentsDebuggingEnabled(true);
            android.util.Log.i(TAG, "WebView debugging enabled for CDP capture");
        } catch (Throwable error) {
            android.util.Log.w(TAG, "Enable WebView debugging failed: " + error.getMessage());
        }
    }

    public static int nextCaptureRequestId() {
        return requestIdCounter.incrementAndGet();
    }

    public static Object wrapGnetCronetCallback(String initialUrl, Object callback, Object executor) {
        try {
            if (!(callback instanceof gnet.android.org.chromium.net.UrlRequest.Callback)) return callback;
            if (callback instanceof GnetCronetCaptureCallback) return callback;
            return new GnetCronetCaptureCallback(initialUrl != null ? initialUrl : "",
                (gnet.android.org.chromium.net.UrlRequest.Callback) callback,
                executor instanceof Executor ? (Executor) executor : null);
        } catch (Throwable ignored) {
            return callback;
        }
    }

    public static void sendGnetRequest(int id, String url) {
        nativeSendMessage(buildRequestJson(id, "GET", url, new LinkedHashMap<String, String>(), "", "GNet"));
    }

    static void sendGnetRequest(int id, String method, String url, Map<String, String> headers) {
        nativeSendMessage(buildRequestJson(id, method, url, headers, "", "GNet"));
    }

    public static void sendGnetResponse(int id, String url, int status, Map<String, String> headers, byte[] body) {
        nativeSendMessage(buildResponseJson(id, status, "GET", url, headers,
            formatCronetBody(body, headers), null, "GNet"));
    }

    static void sendGnetResponse(int id, String method, String url, MockResponseSpec response, JSONObject rule) {
        nativeSendMessage(buildResponseJson(id, response.statusCode, method, url, response.headers,
            formatCronetBody(response.body, response.headers), rule, "GNet"));
    }

    public static void updateMockConfig(String message) {
        try {
            JSONObject packet = new JSONObject(message);
            if (!"mock_config_update".equals(packet.optString("type"))) return;
            JSONObject data = packet.optJSONObject("data");
            if (data == null) {
                mockConfig = null;
            } else {
                mockConfig = data;
            }
            android.util.Log.i(TAG, "Mock config updated");
            sendMockDebug("config_updated", describeMockConfig(data));
        } catch (Exception e) {
            android.util.Log.e(TAG, "updateMockConfig failed: " + e.getMessage());
            sendMockDebug("config_error", e.getMessage());
        }
    }

    // ============================================================
    // Called from JVMTI Breakpoint on OkHttpClient.newCall(Request)
    // Injects our interceptor into the client via reflection.
    // ============================================================

    public static void ensureInterceptorInjected(Object client) {
        try {
            int clientId = System.identityHashCode(client);
            synchronized (injectedClients) {
                if (injectedClients.contains(clientId)) return;
                injectedClients.add(clientId);
            }

            Object interceptor = getOrCreateInterceptor();
            if (interceptor == null) return;

            // Use client.newBuilder() to create a modified copy,
            // then copy its interceptor list back to the original client.
            // This is the safest way to add interceptors to an existing client.
            Class<?> builderClass = client.getClass().getMethod("newBuilder").getReturnType();
            Object builder = client.getClass().getMethod("newBuilder").invoke(client);

            Class<?> interceptorClass = Class.forName("okhttp3.Interceptor");
            Method addMethod = builderClass.getMethod("addInterceptor", interceptorClass);
            addMethod.invoke(builder, interceptor);

            Object newClient = builderClass.getMethod("build").invoke(builder);

            // Mock replace mode cannot run in a network interceptor because OkHttp
            // requires network interceptors to call proceed() exactly once. Inject as
            // an application interceptor and copy the immutable interceptor list back.
            Field interceptorsField = findField(client.getClass(), "interceptors");
            if (interceptorsField != null) {
                interceptorsField.setAccessible(true);
                Object newList = interceptorsField.get(newClient);
                interceptorsField.set(client, newList);
                android.util.Log.i(TAG, "Application interceptor injected into existing OkHttpClient");
            }
        } catch (Exception e) {
            android.util.Log.e(TAG, "injectInterceptor failed: " + e.getMessage());
        }
    }

    private static Object getOrCreateInterceptor() {
        if (cachedInterceptor != null) return cachedInterceptor;
        try {
            Class<?> interceptorClass = Class.forName("okhttp3.Interceptor");
            cachedInterceptor = Proxy.newProxyInstance(
                interceptorClass.getClassLoader(),
                new Class<?>[] { interceptorClass },
                new InterceptorInvocationHandler()
            );
            return cachedInterceptor;
        } catch (Exception e) {
            android.util.Log.e(TAG, "createInterceptor failed: " + e.getMessage());
            return null;
        }
    }

    /** Recursively search for a field in class hierarchy */
    private static Field findField(Class<?> clazz, String name) {
        while (clazz != null) {
            try {
                return clazz.getDeclaredField(name);
            } catch (NoSuchFieldException e) {
                clazz = clazz.getSuperclass();
            }
        }
        return null;
    }

    // ============================================================
    // Dynamic Proxy for OkHttp Interceptor
    // ============================================================

    private static class InterceptorInvocationHandler implements InvocationHandler {
        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            if ("intercept".equals(method.getName()) && args != null && args.length == 1) {
                try {
                    return handleIntercept(args[0]);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    Throwable cause = e.getCause();
                    if (cause instanceof java.io.IOException) {
                        throw (java.io.IOException) cause;
                    }
                    if (cause instanceof RuntimeException) {
                        throw (RuntimeException) cause;
                    }
                    // Fallback: unexpected checked exception, bypass interception
                    android.util.Log.e(TAG, "Unexpected error in intercept, falling back to direct proceed: " + cause);
                    return directProceed(args[0]);
                } catch (java.io.IOException e) {
                    // Preserve OkHttp's declared network exception contract. Wrapping
                    // IOException as RuntimeException bypasses host app error handling.
                    throw e;
                } catch (Exception e) {
                    // Fallback: any unexpected exception, bypass interception
                    android.util.Log.e(TAG, "Intercept error, falling back to direct proceed: " + e.getMessage());
                    return directProceed(args[0]);
                }
            }
            if ("toString".equals(method.getName())) return "HadiceInterceptor";
            if ("hashCode".equals(method.getName())) return System.identityHashCode(proxy);
            if ("equals".equals(method.getName())) return proxy == args[0];
            return null;
        }
    }

    // ============================================================
    // Core intercept logic
    // ============================================================

    private static Object handleIntercept(Object chain) throws Exception {
        int requestId = requestIdCounter.incrementAndGet();

        String method = "GET";
        String url = "";
        Map<String, String> reqHeaders = new java.util.HashMap<>();
        String reqBody = "";

        Object request = null;

        // Capture request
        try {
            request = chain.getClass().getMethod("request").invoke(chain);
            if (request != null) {
                method = (String) request.getClass().getMethod("method").invoke(request);
                Object urlObj = request.getClass().getMethod("url").invoke(request);
                if (urlObj != null) url = urlObj.toString();
                Object headersObj = request.getClass().getMethod("headers").invoke(request);
                if (headersObj != null) reqHeaders = extractHeaders(headersObj);
                Object bodyObj = request.getClass().getMethod("body").invoke(request);
                if (bodyObj != null) reqBody = extractRequestBody(bodyObj);
            }
        } catch (Exception e) {
            android.util.Log.e(TAG, "capture request error: " + e.getMessage());
        }

        nativeSendMessage(buildRequestJson(requestId, method, url, reqHeaders, reqBody, "OkHttp"));

        JSONObject matchedRule = findMockRule(method, url, reqHeaders, reqBody);
        if (matchedRule != null && "replace".equals(matchedRule.optString("responseMode", "replace"))) {
            try {
                sendMockDebug("rule_matched", matchedRule.optString("name", matchedRule.optString("id", "")) + " url=" + url);
                Object mockResponse = buildMockResponse(request, null, matchedRule);
                if (mockResponse != null) {
                    sendMockResponseRecord(requestId, method, url, matchedRule, mockResponse);
                    return mockResponse;
                }
            } catch (Exception e) {
                android.util.Log.e(TAG, "replace mock failed, falling back to real request: " + e.getMessage());
                sendMockDebug("replace_failed", e.getMessage());
            }
        }

        // Execute original request
        Object response = null;
        try {
            if (request == null) request = chain.getClass().getMethod("request").invoke(chain);
            response = chain.getClass().getMethod("proceed", request.getClass()).invoke(chain, request);
        } catch (java.lang.reflect.InvocationTargetException e) {
            Throwable cause = e.getCause();
            android.util.Log.e(TAG, "proceed failed: " + cause.getMessage());
            if (cause instanceof java.io.IOException) throw (java.io.IOException) cause;
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            if (cause instanceof Error) throw (Error) cause;
            if (cause instanceof Exception) throw (Exception) cause;
            throw new RuntimeException(cause);
        } catch (Exception e) {
            android.util.Log.e(TAG, "proceed error: " + e.getMessage());
            throw e;
        }

        // Capture response
        if (response != null) {
            try {
                int statusCode = 0;
                Map<String, String> respHeaders = new java.util.HashMap<>();
                String respBody = "";

                Object codeObj = response.getClass().getMethod("code").invoke(response);
                if (codeObj instanceof Integer) statusCode = (Integer) codeObj;

                Object headersObj = response.getClass().getMethod("headers").invoke(response);
                if (headersObj != null) respHeaders = extractHeaders(headersObj);

                try {
                    String encoding = respHeaders.get("Content-Encoding");
                    String contentType = respHeaders.get("Content-Type");

                    // Read body bytes
                    Method peekMethod = response.getClass().getMethod("peekBody", long.class);
                    Object peekBody = peekMethod.invoke(response, 1024 * 1024L);
                    if (peekBody != null) {
                        // Image types: base64 encode for frontend display
                        if (contentType != null && contentType.startsWith("image/")) {
                            try {
                                Method bytesMethod = peekBody.getClass().getMethod("bytes");
                                byte[] rawBytes = (byte[]) bytesMethod.invoke(peekBody);
                                if (rawBytes != null && rawBytes.length > 0 && rawBytes.length < 3 * 1024 * 1024) {
                                    respBody = "data:" + contentType + ";base64,"
                                        + android.util.Base64.encodeToString(rawBytes, android.util.Base64.NO_WRAP);
                                } else if (rawBytes != null && rawBytes.length >= 512 * 1024) {
                                    respBody = "[image too large: " + rawBytes.length + " bytes]";
                                }
                            } catch (Exception ignored) {}
                        } else if (isBinaryContentType(contentType)) {
                            respBody = "[binary:" + (contentType != null ? contentType : "unknown") + "]";
                        } else if (encoding != null && (encoding.equalsIgnoreCase("gzip")
                                || encoding.equalsIgnoreCase("deflate"))) {
                            // Decompress gzip/deflate body using standard Java API
                            try {
                                Method bytesMethod = peekBody.getClass().getMethod("bytes");
                                byte[] rawBytes = (byte[]) bytesMethod.invoke(peekBody);
                                if (rawBytes != null && rawBytes.length > 0) {
                                    java.io.ByteArrayInputStream bais = new java.io.ByteArrayInputStream(rawBytes);
                                    java.util.zip.GZIPInputStream gzis = new java.util.zip.GZIPInputStream(bais);
                                    java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                                    byte[] buf = new byte[4096];
                                    int n;
                                    while ((n = gzis.read(buf)) != -1) baos.write(buf, 0, n);
                                    gzis.close();
                                    respBody = baos.toString("UTF-8");
                                }
                            } catch (Exception ignored) {}
                        }

                        if (respBody.isEmpty()) {
                            try {
                                Object str = peekBody.getClass().getMethod("string").invoke(peekBody);
                                if (str != null) respBody = str.toString();
                            } catch (Exception ignored) {}
                        }
                    }
                } catch (Exception ignored) {}

                if (matchedRule != null && "override".equals(matchedRule.optString("responseMode", ""))) {
                    try {
                        sendMockDebug("rule_matched", matchedRule.optString("name", matchedRule.optString("id", "")) + " url=" + url);
                        Object mockResponse = buildMockResponse(request, response, matchedRule);
                        if (mockResponse != null) {
                            response = mockResponse;
                            respHeaders.put("Hadice-Mock", "true");
                            JSONObject responseConfig = matchedRule.optJSONObject("responseConfig");
                            if (responseConfig != null) {
                                if (responseConfig.has("statusCode")) statusCode = responseConfig.optInt("statusCode", statusCode);
                                if (responseConfig.has("body")) respBody = responseConfig.optString("body", respBody);
                                JSONObject mockHeaders = responseConfig.optJSONObject("headers");
                                if (mockHeaders != null) {
                                    JSONArray names = mockHeaders.names();
                                    if (names != null) {
                                        for (int i = 0; i < names.length(); i++) {
                                            String name = names.getString(i);
                                            respHeaders.put(name, mockHeaders.optString(name, ""));
                                        }
                                    }
                                }
                            }
                        }
                    } catch (Exception e) {
                        android.util.Log.e(TAG, "override mock failed, keeping real response: " + e.getMessage());
                        sendMockDebug("override_failed", e.getMessage());
                    }
                }

                nativeSendMessage(buildResponseJson(requestId, statusCode, method, url, respHeaders, respBody, matchedRule, "OkHttp"));
            } catch (Exception e) {
                android.util.Log.e(TAG, "capture response error: " + e.getMessage());
            }
        }

        return response;
    }

    private static JSONObject findMockRule(String method, String url, Map<String, String> headers, String body) {
        JSONObject config = mockConfig;
        if (config == null) {
            sendMockDebugLimited("no_config", "url=" + url);
            return null;
        }
        if (!config.optBoolean("enabled", false)) {
            sendMockDebugLimited("disabled", "url=" + url);
            return null;
        }
        JSONArray rules = config.optJSONArray("rules");
        if (rules == null || rules.length() == 0) {
            sendMockDebugLimited("no_rules", "url=" + url);
            return null;
        }

        String lastMiss = "";
        for (int i = 0; i < rules.length(); i++) {
            JSONObject rule = rules.optJSONObject(i);
            if (rule == null) {
                lastMiss = "rule[" + i + "] null";
                continue;
            }
            if (!rule.optBoolean("enabled", false)) {
                lastMiss = "rule[" + i + "] disabled";
                continue;
            }
            JSONObject condition = rule.optJSONObject("matchCondition");
            if (condition == null) {
                lastMiss = "rule[" + i + "] no condition";
                continue;
            }

            String urlPattern = condition.optString("urlPattern", "");
            if (urlPattern.length() == 0) {
                lastMiss = "rule[" + i + "] empty url pattern";
                continue;
            }
            boolean urlRegex = condition.optBoolean("urlRegex", true);
            if (!matchesPatternOrLiteral(urlPattern, url, urlRegex)) {
                lastMiss = "rule[" + i + "] url miss pattern=" + urlPattern + " url=" + url;
                continue;
            }

            String ruleMethod = condition.optString("method", "");
            if (ruleMethod.length() > 0 && !ruleMethod.equalsIgnoreCase(method)) {
                lastMiss = "rule[" + i + "] method miss expected=" + ruleMethod + " actual=" + method;
                continue;
            }

            String bodyPattern = condition.optString("bodyPattern", "");
            if (bodyPattern.length() > 0 && !matchesPatternOrLiteral(bodyPattern, body != null ? body : "")) {
                lastMiss = "rule[" + i + "] body miss";
                continue;
            }

            JSONObject headerRules = condition.optJSONObject("headers");
            if (headerRules != null && !headersMatch(headerRules, headers)) {
                lastMiss = "rule[" + i + "] header miss";
                continue;
            }

            return rule;
        }
        sendMockDebugLimited("no_match", lastMiss.length() > 0 ? lastMiss : ("url=" + url));
        return null;
    }

    private static boolean matchesPatternOrLiteral(String pattern, String value) {
        return matchesPatternOrLiteral(pattern, value, true);
    }

    private static boolean matchesPatternOrLiteral(String pattern, String value, boolean regex) {
        if (pattern == null || pattern.length() == 0) return false;
        String safeValue = value != null ? value : "";
        if (regex) {
            try {
                if (Pattern.compile(pattern).matcher(safeValue).find()) return true;
            } catch (Exception ignored) {}
        }
        return safeValue.contains(pattern);
    }

    private static boolean headersMatch(JSONObject expected, Map<String, String> actual) {
        try {
            JSONArray names = expected.names();
            if (names == null) return true;
            for (int i = 0; i < names.length(); i++) {
                String name = names.getString(i);
                String pattern = expected.optString(name, "");
                String value = actual.get(name);
                if (value == null || !matchesPatternOrLiteral(pattern, value)) return false;
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static Object buildMockResponse(Object request, Object originalResponse, JSONObject rule) throws Exception {
        JSONObject responseConfig = rule.optJSONObject("responseConfig");
        if (responseConfig == null) responseConfig = new JSONObject();

        Object builder;
        if (originalResponse != null) {
            builder = originalResponse.getClass().getMethod("newBuilder").invoke(originalResponse);
        } else {
            Class<?> builderClass = Class.forName("okhttp3.Response$Builder");
            builder = builderClass.newInstance();
            builder.getClass().getMethod("request", request.getClass()).invoke(builder, request);
            Class<?> protocolClass = Class.forName("okhttp3.Protocol");
            Object protocol = Enum.valueOf((Class<Enum>) protocolClass.asSubclass(Enum.class), "HTTP_1_1");
            builder.getClass().getMethod("protocol", protocolClass).invoke(builder, protocol);
        }

        int status = responseConfig.has("statusCode") ? responseConfig.optInt("statusCode", 200) : 200;
        if (originalResponse != null && !responseConfig.has("statusCode")) {
            Object codeObj = originalResponse.getClass().getMethod("code").invoke(originalResponse);
            if (codeObj instanceof Integer) status = (Integer) codeObj;
        }
        builder.getClass().getMethod("code", int.class).invoke(builder, status);
        builder.getClass().getMethod("message", String.class).invoke(builder, statusMessage(status));

        JSONObject headers = responseConfig.optJSONObject("headers");
        if (headers != null) {
            JSONArray names = headers.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String name = names.getString(i);
                    builder.getClass().getMethod("header", String.class, String.class)
                        .invoke(builder, name, headers.optString(name, ""));
                }
            }
        }
        builder.getClass().getMethod("header", String.class, String.class)
            .invoke(builder, "Hadice-Mock", "true");

        if (responseConfig.has("body") || originalResponse == null) {
            String body = responseConfig.optString("body", "");
            String contentType = "application/json; charset=utf-8";
            if (headers != null) contentType = optHeader(headers, "Content-Type", contentType);
            byte[] bodyBytes = body.getBytes("UTF-8");
            builder.getClass().getMethod("header", String.class, String.class)
                .invoke(builder, "Content-Type", contentType);
            builder.getClass().getMethod("header", String.class, String.class)
                .invoke(builder, "Content-Length", String.valueOf(bodyBytes.length));
            Object responseBody = createResponseBody(contentType, body);
            if (responseBody != null) {
                Class<?> responseBodyClass = Class.forName("okhttp3.ResponseBody");
                builder.getClass().getMethod("body", responseBodyClass).invoke(builder, responseBody);
            }
            sendMockDebug("response_built", "status=" + status + " bodyLen=" + bodyBytes.length + " contentType=" + contentType);
        }

        long now = System.currentTimeMillis();
        setLongIfPresent(builder, "sentRequestAtMillis", now);
        setLongIfPresent(builder, "receivedResponseAtMillis", now);
        return builder.getClass().getMethod("build").invoke(builder);
    }

    private static String optHeader(JSONObject headers, String name, String fallback) {
        if (headers == null) return fallback;
        String value = headers.optString(name, null);
        if (value != null && value.length() > 0) return value;
        try {
            JSONArray names = headers.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String key = names.getString(i);
                    if (name.equalsIgnoreCase(key)) {
                        String headerValue = headers.optString(key, fallback);
                        return headerValue != null && headerValue.length() > 0 ? headerValue : fallback;
                    }
                }
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    private static void setLongIfPresent(Object builder, String methodName, long value) {
        try {
            builder.getClass().getMethod(methodName, long.class).invoke(builder, value);
        } catch (Exception ignored) {}
    }

    private static String statusMessage(int status) {
        if (status >= 200 && status < 300) return "OK";
        if (status >= 300 && status < 400) return "Redirect";
        if (status == 400) return "Bad Request";
        if (status == 401) return "Unauthorized";
        if (status == 403) return "Forbidden";
        if (status == 404) return "Not Found";
        if (status >= 500) return "Server Error";
        return "OK";
    }

    private static Object createResponseBody(String contentType, String body) throws Exception {
        Class<?> mediaTypeClass = Class.forName("okhttp3.MediaType");
        Object mediaType = null;
        try {
            mediaType = mediaTypeClass.getMethod("parse", String.class).invoke(null, contentType);
        } catch (Exception ignored) {
            mediaType = mediaTypeClass.getMethod("get", String.class).invoke(null, contentType);
        }

        Class<?> responseBodyClass = Class.forName("okhttp3.ResponseBody");
        try {
            return responseBodyClass.getMethod("create", mediaTypeClass, String.class).invoke(null, mediaType, body);
        } catch (Exception ignored) {}
        try {
            return responseBodyClass.getMethod("create", String.class, mediaTypeClass).invoke(null, body, mediaType);
        } catch (Exception ignored) {}
        try {
            return responseBodyClass.getMethod("create", mediaTypeClass, byte[].class)
                .invoke(null, mediaType, body.getBytes("UTF-8"));
        } catch (Exception ignored) {}
        return responseBodyClass.getMethod("create", byte[].class, mediaTypeClass)
            .invoke(null, body.getBytes("UTF-8"), mediaType);
    }

    private static void sendMockResponseRecord(int requestId, String method, String url, JSONObject rule, Object response) {
        try {
            int statusCode = 200;
            Map<String, String> headers = new java.util.HashMap<>();
            String body = "";

            Object codeObj = response.getClass().getMethod("code").invoke(response);
            if (codeObj instanceof Integer) statusCode = (Integer) codeObj;
            Object headersObj = response.getClass().getMethod("headers").invoke(response);
            if (headersObj != null) headers = extractHeaders(headersObj);
            JSONObject responseConfig = rule.optJSONObject("responseConfig");
            if (responseConfig != null) body = responseConfig.optString("body", "");

            nativeSendMessage(buildResponseJson(requestId, statusCode, method, url, headers, body, rule, "OkHttp"));
        } catch (Exception e) {
            android.util.Log.e(TAG, "send mock response record failed: " + e.getMessage());
        }
    }

    /**
     * Fallback: directly call chain.proceed(request) without any interception.
     * Used when the capture logic encounters an unexpected error to ensure
     * the request still goes through and the host app is unaffected.
     */
    private static Object directProceed(Object chain) throws Throwable {
        try {
            Object request = chain.getClass().getMethod("request").invoke(chain);
            return chain.getClass().getMethod("proceed", request.getClass()).invoke(chain, request);
        } catch (java.lang.reflect.InvocationTargetException e) {
            Throwable cause = e.getCause();
            android.util.Log.e(TAG, "directProceed failed: " + cause);
            if (cause instanceof java.io.IOException) throw (java.io.IOException) cause;
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw new RuntimeException(cause);
        } catch (Exception e) {
            android.util.Log.e(TAG, "directProceed error: " + e.getMessage());
            throw new RuntimeException(e);
        }
    }

    // ============================================================
    // Cronet capture
    // ============================================================

    private static final Map<Object, CronetCaptureState> cronetBuilderStates =
        Collections.synchronizedMap(new WeakHashMap<Object, CronetCaptureState>());
    private static final ThreadLocal<CronetCaptureState> pendingCronetCapture = new ThreadLocal<>();

    /**
     * Called from the JVMTI breakpoint on CronetEngine.newUrlRequestBuilder().
     * The native agent replaces the method's Callback parameter with the returned
     * wrapper, which forwards every lifecycle callback to the original instance.
     */
    public static Object wrapCronetCallback(String initialUrl, Object callback, Object executor) {
        try {
            if (!(callback instanceof UrlRequest.Callback)) return callback;
            if (callback instanceof CronetCaptureCallback) return callback;
            CronetCaptureState state = new CronetCaptureState(
                initialUrl != null ? initialUrl : "",
                (UrlRequest.Callback) callback,
                executor instanceof Executor ? (Executor) executor : null);
            pendingCronetCapture.set(state);
            return new CronetCaptureCallback(state, (UrlRequest.Callback) callback);
        } catch (Throwable error) {
            android.util.Log.w(TAG, "Cronet callback wrapping skipped: " + error.getMessage());
            return callback;
        }
    }

    /** Associates a builder with the capture state created for the current newUrlRequestBuilder call. */
    public static void linkCronetBuilder(Object builder) {
        try {
            if (builder == null) return;
            if (cronetBuilderStates.containsKey(builder)) return;
            CronetCaptureState pending = pendingCronetCapture.get();
            if (pending != null) {
                cronetBuilderStates.put(builder, pending);
                pendingCronetCapture.remove();
            }
        } catch (Throwable ignored) {
        }
    }

    public static void recordCronetHttpMethod(Object builder, String method) {
        try {
            CronetCaptureState state = resolveCronetBuilderState(builder);
            if (state != null && method != null && method.length() > 0) {
                state.method = method;
            }
        } catch (Throwable ignored) {
        }
    }

    public static void recordCronetHeader(Object builder, String name, String value) {
        try {
            CronetCaptureState state = resolveCronetBuilderState(builder);
            if (state != null && name != null && value != null) {
                state.requestHeaders.put(name, value);
            }
        } catch (Throwable ignored) {
        }
    }

    public static Object wrapCronetUploadProvider(Object provider, Object builder) {
        try {
            if (!(provider instanceof UploadDataProvider)) return provider;
            if (provider instanceof CaptureUploadDataProvider) return provider;
            CronetCaptureState state = resolveCronetBuilderState(builder);
            if (state == null) return provider;
            return new CaptureUploadDataProvider((UploadDataProvider) provider, state);
        } catch (Throwable error) {
            android.util.Log.w(TAG, "Cronet upload provider wrapping skipped: " + error.getMessage());
            return provider;
        }
    }

    /** Records the ByteBuffer position before CronetUrlRequest.read() hands off to the network stack. */
    public static void recordCronetReadStart(Object request, Object buffer) {
        try {
            if (!(buffer instanceof ByteBuffer)) return;
            CronetCaptureState state = resolveCronetRequestState(request);
            if (state != null) {
                state.recordReadStart((ByteBuffer) buffer);
            }
        } catch (Throwable ignored) {
        }
    }

    /**
     * 在 Builder.build() 的断点调用。返回 null 表示没有可安全短路的 Replace 规则，
     * 由 JVMTI 继续执行真实 Cronet build。
     */
    public static Object createCronetMockRequest(Object builder) {
        try {
            CronetCaptureState state = resolveCronetBuilderState(builder);
            if (state == null || state.callback == null || state.executor == null) return null;
            JSONObject rule = findMockRule(state.method, state.url, state.requestHeaders, "");
            if (rule == null || !"replace".equals(rule.optString("responseMode", "replace"))) return null;
            JSONObject condition = rule.optJSONObject("matchCondition");
            if (condition != null && condition.optString("bodyPattern", "").length() > 0) {
                sendMockDebug("cronet_mock_skipped", "bodyPattern requires request body; url=" + state.url);
                return null;
            }
            MockResponseSpec response = MockResponseSpec.fromRule(rule);
            return new MockCronetUrlRequest(state, response, rule);
        } catch (Throwable error) {
            sendMockDebug("cronet_mock_create_failed", String.valueOf(error.getMessage()));
            return null;
        }
    }

    private static final Map<Object, GnetCronetCaptureCallback> gnetBuilderStates =
        Collections.synchronizedMap(new WeakHashMap<Object, GnetCronetCaptureCallback>());
    private static final ThreadLocal<GnetCronetCaptureCallback> pendingGnetCapture = new ThreadLocal<>();

    static void registerGnetCronetCallback(GnetCronetCaptureCallback callback) {
        if (callback != null) pendingGnetCapture.set(callback);
    }

    public static void linkGnetCronetBuilder(Object builder) {
        if (builder == null || gnetBuilderStates.containsKey(builder)) return;
        GnetCronetCaptureCallback callback = pendingGnetCapture.get();
        if (callback != null) {
            gnetBuilderStates.put(builder, callback);
            pendingGnetCapture.remove();
        }
    }

    public static void recordGnetCronetHttpMethod(Object builder, String method) {
        linkGnetCronetBuilder(builder);
        GnetCronetCaptureCallback callback = gnetBuilderStates.get(builder);
        if (callback != null) callback.setRequestMethod(method);
    }

    public static void recordGnetCronetHeader(Object builder, String name, String value) {
        linkGnetCronetBuilder(builder);
        GnetCronetCaptureCallback callback = gnetBuilderStates.get(builder);
        if (callback != null) callback.setRequestHeader(name, value);
    }

    public static Object createGnetCronetMockRequest(Object builder) {
        try {
            linkGnetCronetBuilder(builder);
            GnetCronetCaptureCallback callback = gnetBuilderStates.get(builder);
            if (callback == null) {
                sendMockDebug("gnet_cronet_mock_missing_state",
                    "Builder was not linked to its newUrlRequestBuilder callback");
                android.util.Log.w(TAG, "gnet Cronet Mock skipped: Builder state is missing");
                return null;
            }
            return callback.createMockRequest();
        } catch (Throwable error) {
            sendMockDebug("gnet_cronet_mock_create_failed", String.valueOf(error.getMessage()));
            return null;
        }
    }

    static JSONObject findGnetMockRule(String method, String url, Map<String, String> headers) {
        return findMockRule(method, url, headers, "");
    }

    static void sendGnetMockDebug(String event, String detail) {
        sendMockDebug(event, detail);
    }

    private static CronetCaptureState resolveCronetBuilderState(Object builder) {
        if (builder == null) return null;
        linkCronetBuilder(builder);
        return cronetBuilderStates.get(builder);
    }

    private static CronetCaptureState resolveCronetRequestState(Object request) {
        if (request == null) return null;
        synchronized (cronetBuilderStates) {
            for (CronetCaptureState state : cronetBuilderStates.values()) {
                if (state.linkedRequest == request) return state;
            }
        }
        return null;
    }

    private static final class CronetCaptureState {
        final int requestId;
        String url;
        String method = "GET";
        final Map<String, String> requestHeaders = new LinkedHashMap<>();
        final ByteArrayOutputStream requestBody = new ByteArrayOutputStream();
        final Map<Integer, Integer> readStartPositions = new HashMap<>();
        Object linkedRequest;
        int statusCode;
        Map<String, String> responseHeaders = new LinkedHashMap<>();
        final ByteArrayOutputStream responseBody = new ByteArrayOutputStream();
        boolean requestSent;
        boolean responseSent;

        final UrlRequest.Callback callback;
        final Executor executor;

        CronetCaptureState(String initialUrl, UrlRequest.Callback callback, Executor executor) {
            requestId = requestIdCounter.incrementAndGet();
            url = initialUrl;
            this.callback = callback;
            this.executor = executor;
        }

        void linkRequest(Object request) {
            if (request != null && linkedRequest == null) {
                linkedRequest = request;
            }
        }

        void recordReadStart(ByteBuffer buffer) {
            readStartPositions.put(System.identityHashCode(buffer), buffer.position());
        }

        synchronized void appendRequestBody(ByteBuffer buffer, int startPosition) {
            if (requestBody.size() >= CRONET_MAX_BODY_BYTES) return;
            int endPosition = buffer.position();
            if (endPosition <= startPosition) return;
            int length = Math.min(endPosition - startPosition, CRONET_MAX_BODY_BYTES - requestBody.size());
            if (length <= 0) return;
            byte[] data = new byte[length];
            ByteBuffer copy = buffer.duplicate();
            copy.position(startPosition);
            copy.get(data, 0, length);
            requestBody.write(data, 0, length);
        }

        synchronized void appendResponseBody(ByteBuffer buffer) {
            if (responseBody.size() >= CRONET_MAX_BODY_BYTES) return;
            int endPosition = buffer.position();
            Integer startPosition = readStartPositions.remove(System.identityHashCode(buffer));
            int start = startPosition != null ? startPosition : 0;
            if (endPosition <= start) return;
            int length = Math.min(endPosition - start, CRONET_MAX_BODY_BYTES - responseBody.size());
            if (length <= 0) return;
            byte[] data = new byte[length];
            ByteBuffer copy = buffer.duplicate();
            copy.position(start);
            copy.limit(endPosition);
            copy.get(data, 0, length);
            responseBody.write(data, 0, length);
        }

        synchronized String requestBodyText() {
            if (requestBody.size() == 0) return "";
            return formatCronetBody(requestBody.toByteArray(), requestHeaders);
        }
    }

    private static final class CaptureUploadDataProvider extends UploadDataProvider {
        private final UploadDataProvider delegate;
        private final CronetCaptureState state;

        CaptureUploadDataProvider(UploadDataProvider delegate, CronetCaptureState state) {
            this.delegate = delegate;
            this.state = state;
        }

        @Override
        public void read(UploadDataSink uploadDataSink, ByteBuffer byteBuffer) throws Exception {
            int startPosition = byteBuffer.position();
            delegate.read(uploadDataSink, byteBuffer);
            state.appendRequestBody(byteBuffer, startPosition);
        }

        @Override
        public void rewind(UploadDataSink uploadDataSink) throws Exception {
            delegate.rewind(uploadDataSink);
        }

        @Override
        public long getLength() throws Exception {
            return delegate.getLength();
        }

        @Override
        public void close() throws Exception {
            delegate.close();
        }
    }

    private static final class CronetCaptureCallback extends UrlRequest.Callback {
        private final CronetCaptureState state;
        private final UrlRequest.Callback delegate;

        CronetCaptureCallback(CronetCaptureState state, UrlRequest.Callback delegate) {
            this.state = state;
            this.delegate = delegate;
        }

        @Override
        public void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String newLocationUrl) {
            state.linkRequest(request);
            if (newLocationUrl != null && newLocationUrl.length() > 0) {
                state.url = newLocationUrl;
            }
            delegate.onRedirectReceived(request, info, newLocationUrl);
        }

        @Override
        public void onResponseStarted(UrlRequest request, UrlResponseInfo info) {
            state.linkRequest(request);
            captureResponseInfo(info);
            sendRequest();
            delegate.onResponseStarted(request, info);
        }

        @Override
        public void onReadCompleted(UrlRequest request, UrlResponseInfo info, ByteBuffer byteBuffer) {
            state.linkRequest(request);
            captureResponseInfo(info);
            state.appendResponseBody(byteBuffer);
            delegate.onReadCompleted(request, info, byteBuffer);
        }

        @Override
        public void onSucceeded(UrlRequest request, UrlResponseInfo info) {
            state.linkRequest(request);
            captureResponseInfo(info);
            sendRequest();
            try {
                delegate.onSucceeded(request, info);
            } finally {
                sendResponse();
            }
        }

        @Override
        public void onFailed(UrlRequest request, UrlResponseInfo info, CronetException error) {
            state.linkRequest(request);
            captureResponseInfo(info);
            sendRequest();
            try {
                delegate.onFailed(request, info, error);
            } finally {
                sendResponse();
            }
        }

        @Override
        public void onCanceled(UrlRequest request, UrlResponseInfo info) {
            state.linkRequest(request);
            captureResponseInfo(info);
            sendRequest();
            try {
                delegate.onCanceled(request, info);
            } finally {
                sendResponse();
            }
        }

        private synchronized void sendRequest() {
            if (state.requestSent) return;
            state.requestSent = true;
            try {
                nativeSendMessage(buildRequestJson(
                    state.requestId,
                    state.method,
                    state.url,
                    state.requestHeaders,
                    state.requestBodyText(),
                    "Cronet"));
            } catch (Throwable ignored) {
            }
        }

        private synchronized void sendResponse() {
            if (state.responseSent) return;
            state.responseSent = true;
            try {
                nativeSendMessage(buildResponseJson(
                    state.requestId,
                    state.statusCode,
                    state.method,
                    state.url,
                    state.responseHeaders,
                    formatCronetBody(state.responseBody.toByteArray(), state.responseHeaders),
                    null,
                    "Cronet"
                ));
            } catch (Throwable ignored) {
            }
        }

        private void captureResponseInfo(UrlResponseInfo info) {
            if (info == null) return;
            try {
                state.statusCode = info.getHttpStatusCode();
                String responseUrl = info.getUrl();
                if (responseUrl != null && responseUrl.length() > 0) {
                    state.url = responseUrl;
                }
                state.responseHeaders = flattenCronetHeaders(info.getAllHeaders());
            } catch (Throwable ignored) {
            }
        }
    }

    /** 与具体 Cronet 命名空间无关的 Mock 响应数据。 */
    public static final class MockResponseSpec {
        public final int statusCode;
        public final String statusText;
        public final Map<String, String> headers;
        public final byte[] body;

        private MockResponseSpec(int statusCode, String statusText, Map<String, String> headers, byte[] body) {
            this.statusCode = statusCode;
            this.statusText = statusText;
            this.headers = headers;
            this.body = body;
        }

        public static MockResponseSpec fromRule(JSONObject rule) throws Exception {
            JSONObject config = rule != null ? rule.optJSONObject("responseConfig") : null;
            if (config == null) config = new JSONObject();
            int status = config.has("statusCode") ? config.optInt("statusCode", 200) : 200;
            if (status < 100 || status > 599) status = 200;
            Map<String, String> headers = new LinkedHashMap<>();
            JSONObject configuredHeaders = config.optJSONObject("headers");
            if (configuredHeaders != null) {
                JSONArray names = configuredHeaders.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        String name = names.optString(i, "");
                        if (name.length() > 0) headers.put(name, configuredHeaders.optString(name, ""));
                    }
                }
            }
            String bodyText = config.optString("body", "");
            byte[] body = bodyText.getBytes("UTF-8");
            if (findHeader(headers, "Content-Type") == null) {
                headers.put("Content-Type", "application/json; charset=utf-8");
            }
            headers.put("Content-Length", String.valueOf(body.length));
            headers.put("Hadice-Mock", "true");
            return new MockResponseSpec(status, statusMessage(status), headers, body);
        }
    }

    /**
     * 不触发网络栈的标准 Cronet Request。业务 Callback 仍在原 Executor 上收到
     * 原始 Cronet 约定的 start/read/success 生命周期。
     */
    private static final class MockCronetUrlRequest extends UrlRequest {
        private final CronetCaptureState state;
        private final MockResponseSpec response;
        private final JSONObject rule;
        private final UrlResponseInfo responseInfo;
        private int bodyOffset;
        private boolean started;
        private boolean done;
        private boolean canceled;
        private boolean requestReported;
        private boolean responseReported;

        MockCronetUrlRequest(CronetCaptureState state, MockResponseSpec response, JSONObject rule) {
            this.state = state;
            this.response = response;
            this.rule = rule;
            this.responseInfo = new MockCronetUrlResponseInfo(state.url, response);
        }

        @Override public void start() {
            synchronized (this) {
                if (started || done) return;
                started = true;
                reportRequestLocked();
            }
            executeCallback(new Runnable() {
                @Override public void run() {
                    synchronized (MockCronetUrlRequest.this) {
                        if (done || canceled) return;
                    }
                    state.callback.onResponseStarted(MockCronetUrlRequest.this, responseInfo);
                }
            });
        }

        @Override public void read(final ByteBuffer buffer) {
            if (buffer == null) {
                sendMockDebug("cronet_mock_read_failed", "null response buffer");
                return;
            }
            boolean complete = false;
            synchronized (this) {
                if (!started || done || canceled) return;
                if (bodyOffset >= response.body.length) {
                    done = true;
                    if (!responseReported) {
                        responseReported = true;
                        complete = true;
                    }
                } else {
                    int count = Math.min(buffer.remaining(), response.body.length - bodyOffset);
                    if (count <= 0) {
                        sendMockDebug("cronet_mock_read_failed", "response buffer has no remaining capacity");
                        throw new IllegalArgumentException("Cronet Mock response buffer has no remaining capacity");
                    }
                    buffer.put(response.body, bodyOffset, count);
                    bodyOffset += count;
                }
            }
            if (complete) {
                reportResponse();
                executeCallback(new Runnable() {
                    @Override public void run() {
                        state.callback.onSucceeded(MockCronetUrlRequest.this, responseInfo);
                    }
                });
                return;
            }
            executeCallback(new Runnable() {
                @Override public void run() {
                    synchronized (MockCronetUrlRequest.this) {
                        if (done || canceled) return;
                    }
                    state.callback.onReadCompleted(MockCronetUrlRequest.this, responseInfo, buffer);
                }
            });
        }

        @Override public void cancel() {
            synchronized (this) {
                if (done || canceled) return;
                canceled = true;
                done = true;
            }
            executeCallback(new Runnable() {
                @Override public void run() {
                    state.callback.onCanceled(MockCronetUrlRequest.this, responseInfo);
                }
            });
        }

        @Override public synchronized boolean isDone() {
            return done;
        }

        @Override public void getStatus(final StatusListener listener) {
            if (listener == null) return;
            executeCallback(new Runnable() {
                @Override public void run() {
                    listener.onStatus(isDone() ? 0 : 14);
                }
            });
        }

        private void reportRequestLocked() {
            if (requestReported) return;
            requestReported = true;
            nativeSendMessage(buildRequestJson(state.requestId, state.method, state.url, state.requestHeaders, "", "Cronet"));
        }

        private void reportResponse() {
            nativeSendMessage(buildResponseJson(
                state.requestId, response.statusCode, state.method, state.url, response.headers,
                formatCronetBody(response.body, response.headers), rule, "Cronet"));
        }

        private void executeCallback(Runnable callback) {
            try {
                state.executor.execute(callback);
            } catch (Throwable error) {
                synchronized (this) {
                    done = true;
                }
                sendMockDebug("cronet_mock_executor_failed", String.valueOf(error.getMessage()));
            }
        }
    }

    private static final class MockCronetUrlResponseInfo extends UrlResponseInfo {
        private final String url;
        private final MockResponseSpec response;
        private final Map<String, List<String>> headerMap;
        private final List<Map.Entry<String, String>> headerList;

        MockCronetUrlResponseInfo(String url, MockResponseSpec response) {
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
        @Override public String getNegotiatedProtocol() { return "hadice-mock"; }
        @Override public String getProxyServer() { return ""; }
        @Override public long getReceivedByteCount() { return response.body.length; }
        @Override public boolean isProxy() { return false; }
    }

    private static Map<String, String> flattenCronetHeaders(Map<String, List<String>> headers) {
        Map<String, String> result = new LinkedHashMap<>();
        if (headers == null) return result;
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            String name = entry.getKey();
            List<String> values = entry.getValue();
            if (name == null || values == null) continue;
            result.put(name, joinHeaderValues(values));
        }
        return result;
    }

    private static String joinHeaderValues(List<?> values) {
        StringBuilder joined = new StringBuilder();
        for (Object value : values) {
            if (value == null) continue;
            if (joined.length() > 0) joined.append(", ");
            joined.append(value);
        }
        return joined.toString();
    }

    private static String formatCronetBody(byte[] data, Map<String, String> headers) {
        if (data == null || data.length == 0) return "";
        String contentType = findHeader(headers, "Content-Type");
        if (contentType != null && contentType.toLowerCase().startsWith("image/")) {
            return "data:" + contentType + ";base64,"
                + android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
        }
        if (isBinaryContentType(contentType)) {
            return "[binary:" + (contentType != null ? contentType : "unknown") + "]";
        }
        try {
            return new String(data, "UTF-8");
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String findHeader(Map<String, String> headers, String expectedName) {
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (expectedName.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        }
        return null;
    }

    // ============================================================
    // Utilities
    // ============================================================

    private static Map<String, String> extractHeaders(Object headersObj) {
        // Use TreeMap with case-insensitive key ordering (HTTP/2 headers are lowercase)
        Map<String, String> result = new java.util.TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        try {
            int size = (Integer) headersObj.getClass().getMethod("size").invoke(headersObj);
            Method nameM = headersObj.getClass().getMethod("name", int.class);
            Method valueM = headersObj.getClass().getMethod("value", int.class);
            for (int i = 0; i < size; i++) {
                String n = (String) nameM.invoke(headersObj, i);
                String v = (String) valueM.invoke(headersObj, i);
                if (n != null && v != null) result.put(n, v);
            }
        } catch (Exception ignored) {}
        return result;
    }

    private static boolean isBinaryContentType(String ct) {
        if (ct == null) return false;
        String lower = ct.toLowerCase();
        // Text-based types that are safe to read as string
        if (lower.contains("text/") || lower.contains("json") || lower.contains("xml")
                || lower.contains("javascript") || lower.contains("form-data")
                || lower.contains("x-www-form-urlencoded") || lower.contains("plain"))
            return false;
        // Known binary types
        if (lower.contains("image/") || lower.contains("video/") || lower.contains("audio/")
                || lower.contains("octet-stream") || lower.contains("protobuf")
                || lower.contains("msgpack") || lower.contains("pdf")
                || lower.contains("zip") || lower.contains("gzip")
                || lower.contains("binary"))
            return true;
        // Default: treat unknown types as potentially binary
        return false;
    }

    private static String extractRequestBody(Object bodyObj) {
        try {
            Object ct = bodyObj.getClass().getMethod("contentType").invoke(bodyObj);
            if (ct != null) {
                String ctStr = ct.toString().toLowerCase();
                if (!ctStr.contains("text") && !ctStr.contains("json")
                        && !ctStr.contains("xml") && !ctStr.contains("form")
                        && !ctStr.contains("plain")) {
                    return "[binary:" + ctStr + "]";
                }
            }
            Class<?> bufferClass = Class.forName("okio.Buffer");
            Object buffer = bufferClass.newInstance();
            Class<?> sinkClass = Class.forName("okio.BufferedSink");
            bodyObj.getClass().getMethod("writeTo", sinkClass).invoke(bodyObj, buffer);
            Object utf8 = bufferClass.getMethod("readUtf8").invoke(buffer);
            return utf8 != null ? utf8.toString() : "";
        } catch (Exception e) { return ""; }
    }

    private static String describeMockConfig(JSONObject data) {
        if (data == null) return "null";
        JSONArray rules = data.optJSONArray("rules");
        String firstPattern = "";
        if (rules != null && rules.length() > 0) {
            JSONObject firstRule = rules.optJSONObject(0);
            if (firstRule != null) {
                JSONObject condition = firstRule.optJSONObject("matchCondition");
                if (condition != null) firstPattern = condition.optString("urlPattern", "");
            }
        }
        return "enabled=" + data.optBoolean("enabled", false)
            + " rules=" + (rules != null ? rules.length() : 0)
            + " firstPattern=" + firstPattern;
    }

    private static void sendMockDebugLimited(String event, String detail) {
        if (mockDebugCounter.incrementAndGet() <= 40) {
            sendMockDebug(event, detail);
        }
    }

    private static void sendMockDebug(String event, String detail) {
        try {
            nativeSendMessage("{\"version\":1,\"type\":\"mock_debug\",\"timestamp\":"
                + System.currentTimeMillis()
                + ",\"data\":{\"event\":\"" + esc(event)
                + "\",\"detail\":\"" + esc(detail != null ? detail : "")
                + "\"}}");
        } catch (Exception ignored) {}
    }

    // ============================================================
    // JSON (backend compatible format)
    // ============================================================

    private static String buildRequestJson(int id, String method, String url,
                                           Map<String, String> headers, String body,
                                           String captureSource) {
        StringBuilder sb = new StringBuilder(512);
        sb.append("{\"version\":1,\"type\":\"http_record\",\"timestamp\":")
          .append(System.currentTimeMillis())
          .append(",\"data\":{\"extra\":{\"id\":").append(id)
          .append(",\"uid\":\"req-").append(id).append("\"")
          .append(",\"captureSource\":\"").append(esc(captureSource)).append("\"")
          .append(",\"reqTime\":").append(System.currentTimeMillis())
          .append("},\"request\":{\"method\":\"").append(esc(method))
          .append("\",\"url\":\"").append(esc(url))
          .append("\",\"headers\":{");
        appendHeaders(sb, headers);
        sb.append("},\"data\":\"").append(esc(body))
          .append("\"},\"response\":{},\"id\":").append(id).append("}}");
        return sb.toString();
    }

    private static String buildResponseJson(int id, int status, String method, String url,
                                            Map<String, String> headers, String body,
                                            JSONObject mockRule, String captureSource) {
        StringBuilder sb = new StringBuilder(512);
        sb.append("{\"version\":1,\"type\":\"http_record\",\"timestamp\":")
          .append(System.currentTimeMillis())
          .append(",\"data\":{\"extra\":{\"id\":").append(id)
          .append(",\"uid\":\"req-").append(id).append("\"")
          .append(",\"captureSource\":\"").append(esc(captureSource)).append("\"")
          .append(",\"respTime\":").append(System.currentTimeMillis());
        if (mockRule != null) {
            sb.append(",\"mocked\":true")
              .append(",\"mockRuleId\":\"").append(esc(mockRule.optString("id", ""))).append("\"")
              .append(",\"mockRuleName\":\"").append(esc(mockRule.optString("name", ""))).append("\"");
        }
        sb.append("}")
          .append(",\"request\":{\"method\":\"").append(esc(method))
          .append("\",\"url\":\"").append(esc(url))
          .append("\"},\"response\":{\"status\":").append(status)
          .append(",\"headers\":{");
        appendHeaders(sb, headers);
        sb.append("},\"data\":\"").append(esc(body))
          .append("\"},\"id\":").append(id).append("}}");
        return sb.toString();
    }

    private static void appendHeaders(StringBuilder sb, Map<String, String> headers) {
        boolean first = true;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (!first) sb.append(',');
            sb.append('"').append(esc(e.getKey())).append("\":\"")
              .append(esc(e.getValue())).append('"');
            first = false;
        }
    }

    private static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                case '\b': sb.append("\\b");  break;
                case '\f': sb.append("\\f");  break;
                default:
                    if (c < 0x20) {
                        // Escape all other control characters
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }
}
