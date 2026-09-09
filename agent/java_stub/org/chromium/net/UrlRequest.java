package org.chromium.net;

import java.nio.ByteBuffer;
import java.util.concurrent.Executor;

/** Compile-only API stub. The target application's Cronet runtime supplies it. */
public abstract class UrlRequest {
    public abstract void start();
    public abstract void cancel();
    public abstract boolean isDone();
    public abstract void getStatus(StatusListener listener);
    public abstract void read(ByteBuffer byteBuffer);

    public abstract static class StatusListener {
        public abstract void onStatus(int status);
    }

    public abstract static class Builder {
        public abstract Builder setHttpMethod(String method);
        public abstract Builder addHeader(String name, String value);
        public abstract Builder setUploadDataProvider(UploadDataProvider uploadDataProvider, Executor executor);
        public abstract UrlRequest build();
    }

    public abstract static class Callback {
        public abstract void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String newLocationUrl);
        public abstract void onResponseStarted(UrlRequest request, UrlResponseInfo info);
        public abstract void onReadCompleted(UrlRequest request, UrlResponseInfo info, ByteBuffer byteBuffer);
        public abstract void onSucceeded(UrlRequest request, UrlResponseInfo info);
        public abstract void onFailed(UrlRequest request, UrlResponseInfo info, CronetException error);
        public abstract void onCanceled(UrlRequest request, UrlResponseInfo info);
    }
}
