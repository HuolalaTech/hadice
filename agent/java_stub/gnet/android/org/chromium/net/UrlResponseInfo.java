package gnet.android.org.chromium.net;

import java.util.List;
import java.util.Map;

/** Compile-only gnet Cronet API stub. */
public abstract class UrlResponseInfo {
    public abstract int getHttpStatusCode();
    public abstract String getHttpStatusText();
    public abstract Map<String, List<String>> getAllHeaders();
    public abstract List<Map.Entry<String, String>> getAllHeadersAsList();
    public abstract String getUrl();
    public abstract List<String> getUrlChain();
    public abstract boolean wasCached();
    public abstract String getNegotiatedProtocol();
    public abstract String getProtocolName();
    public abstract String getProxyServer();
    public abstract long getReceivedByteCount();
    public abstract boolean isProxy();
}
