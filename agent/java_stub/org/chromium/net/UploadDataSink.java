package org.chromium.net;

/** Compile-only API stub. The target application's Cronet runtime supplies it. */
public abstract class UploadDataSink {
    public abstract void onReadSucceeded(boolean finalChunk);
    public abstract void onReadError(Exception error);
    public abstract void onRewindSucceeded();
    public abstract void onRewindError(Exception error);
}
