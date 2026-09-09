package gnet.android.org.chromium.net;

import java.nio.ByteBuffer;
import java.util.concurrent.Executor;

/** Compile-only gnet Cronet API stub. */
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
        public abstract UrlRequest build();
    }

    public abstract static class Callback {
        public abstract void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String location);
        public abstract void onResponseStarted(UrlRequest request, UrlResponseInfo info);
        public abstract void onReadCompleted(UrlRequest request, UrlResponseInfo info, ByteBuffer buffer);
        public abstract void onSucceeded(UrlRequest request, UrlResponseInfo info);
        public abstract void onFailed(UrlRequest request, UrlResponseInfo info, CronetException error);
        public abstract void onCanceled(UrlRequest request, UrlResponseInfo info);
    }
}
