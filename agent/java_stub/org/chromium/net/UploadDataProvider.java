package org.chromium.net;

import java.nio.ByteBuffer;

/** Compile-only API stub. The target application's Cronet runtime supplies it. */
public abstract class UploadDataProvider {
    public abstract void read(UploadDataSink uploadDataSink, ByteBuffer byteBuffer) throws Exception;
    public abstract void rewind(UploadDataSink uploadDataSink) throws Exception;
    public abstract long getLength() throws Exception;
    public abstract void close() throws Exception;
}
