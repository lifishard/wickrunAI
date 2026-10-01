package dev.anyai.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** HTTPS byte transport. SSE parsing stays in the shared TypeScript consumer. */
@CapacitorPlugin(name = "SncHttp")
public class SncHttpPlugin extends Plugin {
    private static final int MAX_REQUESTS = 16;
    private static final int MAX_BODY_BYTES = 32 * 1024 * 1024;
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(8, 8, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(MAX_REQUESTS), new ThreadPoolExecutor.AbortPolicy());
    // disconnect() can wait for a socket lock. It must not block abort() or the timeout scheduler.
    private final ExecutorService disconnects = Executors.newSingleThreadExecutor();
    private final ScheduledThreadPoolExecutor deadlines = new ScheduledThreadPoolExecutor(1);
    private final ConcurrentHashMap<String, RequestState> active = new ConcurrentHashMap<>();
    private volatile boolean destroyed;

    public SncHttpPlugin() {
        deadlines.setRemoveOnCancelPolicy(true);
    }

    @PluginMethod
    public void request(final PluginCall call) {
        final String requestId = call.getString("requestId", "");
        if (requestId == null || requestId.isEmpty() || requestId.length() > 256) {
            call.reject("A valid request ID is required.");
            return;
        }
        final URL url;
        try {
            url = new URL(call.getString("url", ""));
            if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getUserInfo() != null || url.getHost().isEmpty()) {
                throw new IllegalArgumentException();
            }
        } catch (Exception error) {
            call.reject("An HTTPS API URL without embedded credentials is required.");
            return;
        }
        final String method = call.getString("method", "POST").toUpperCase(Locale.ROOT);
        if (!java.util.Arrays.asList("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS").contains(method)) {
            call.reject("Unsupported HTTP method.");
            return;
        }
        final String body = call.getString("body", "");
        final boolean stream = Boolean.TRUE.equals(call.getBoolean("stream", false));
        final Integer requestedTimeout = call.getInt("timeoutMs", 180000);
        final int timeoutMs = Math.max(1000, Math.min(requestedTimeout == null ? 180000 : requestedTimeout, 1800000));
        final JSObject headers = call.getObject("headers", new JSObject());
        final RequestState state = new RequestState(requestId, call);
        // Publish cancellation state before scheduling; queued requests are cancellable too.
        synchronized (active) {
            if (destroyed) { call.reject("The network bridge is unavailable."); return; }
            if (active.containsKey(requestId)) { call.reject("Request ID is already active."); return; }
            if (active.size() >= MAX_REQUESTS) { call.reject("Too many active network requests."); return; }
            active.put(requestId, state);
        }
        try {
            state.setDeadline(deadlines.schedule(() -> state.fail("The API request timed out.", 0), timeoutMs, TimeUnit.MILLISECONDS));
            pool.execute(() -> perform(state, url, method, body, stream, timeoutMs, headers));
        } catch (RejectedExecutionException error) {
            state.fail("The network bridge is busy or shutting down.", 0);
        }
    }

    private void perform(RequestState state, URL url, String method, String body, boolean stream,
                         int timeoutMs, JSObject headers) {
        HttpURLConnection connection = null;
        try {
            if (state.isSettled()) return;
            connection = (HttpURLConnection) url.openConnection();
            if (!state.attach(connection)) return;
            connection.setRequestMethod(method);
            connection.setConnectTimeout(Math.min(timeoutMs, 30000));
            connection.setReadTimeout(timeoutMs);
            connection.setUseCaches(false);
            // The supplied API credentials must never follow a redirect to another host.
            connection.setInstanceFollowRedirects(false);
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.getString(key);
                    if (value == null || key.contains("\r") || key.contains("\n") || value.contains("\r") || value.contains("\n")) {
                        throw new RequestFailure("Invalid HTTP headers.");
                    }
                    connection.setRequestProperty(key, value);
                }
            }
            if (stream) connection.setRequestProperty("Accept-Encoding", "identity");
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                connection.setDoOutput(true);
                byte[] payload = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(payload.length);
                if (state.isSettled()) return;
                try (OutputStream output = connection.getOutputStream()) {
                    if (state.isSettled()) return;
                    output.write(payload);
                    output.flush();
                }
            }
            if (state.isSettled()) return;
            int status = connection.getResponseCode();
            if (state.isSettled()) return;
            if (status >= 300 && status < 400) {
                state.fail("The API redirected the request. Configure its final HTTPS URL.", status);
                return;
            }
            if (status < 200) throw new RequestFailure("Invalid HTTP response.");
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (status >= 400 || !stream || input == null) {
                String text = readAll(input, state);
                state.finish(status, text, false);
                return;
            }
            try (InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT))) {
                char[] buffer = new char[2048];
                String pendingSurrogate = "";
                int count;
                while (!state.isSettled() && (count = reader.read(buffer)) != -1) {
                    String text = pendingSurrogate + new String(buffer, 0, count);
                    pendingSurrogate = "";
                    if (!text.isEmpty() && Character.isHighSurrogate(text.charAt(text.length() - 1))) {
                        pendingSurrogate = text.substring(text.length() - 1);
                        text = text.substring(0, text.length() - 1);
                    }
                    if (!text.isEmpty()) state.chunk(text);
                }
                if (!state.isSettled() && !pendingSurrogate.isEmpty()) throw new RequestFailure("The API returned incomplete UTF-8 text.");
            }
            state.finish(status, null, true);
        } catch (SocketTimeoutException error) {
            state.fail("The API request timed out.", 0);
        } catch (CharacterCodingException error) {
            state.fail("The API returned invalid UTF-8 text.", 0);
        } catch (RequestFailure error) {
            state.fail(error.getMessage(), 0);
        } catch (Exception error) {
            // Exception messages can include request URLs; never expose credentials from them.
            state.fail("The API connection failed. Check the URL, network and certificate.", 0);
        } finally {
            if (connection != null) {
                try { connection.disconnect(); } catch (Exception ignored) { }
            }
        }
    }

    @PluginMethod
    public void abort(final PluginCall call) {
        String requestId = call.getString("requestId", "");
        RequestState state = requestId == null ? null : active.get(requestId);
        if (state != null) state.cancel();
        // Unknown/completed IDs do not create tombstones that poison future requests.
        call.resolve();
    }

    private final class RequestState {
        private final String id;
        private final PluginCall call;
        private final AtomicBoolean settled = new AtomicBoolean(false);
        private HttpURLConnection connection;
        private ScheduledFuture<?> deadline;

        RequestState(String id, PluginCall call) { this.id = id; this.call = call; }
        boolean isSettled() { return settled.get(); }
        synchronized boolean attach(HttpURLConnection next) {
            if (isSettled()) return false;
            connection = next;
            return true;
        }
        synchronized void setDeadline(ScheduledFuture<?> next) {
            if (isSettled()) next.cancel(false);
            else deadline = next;
        }
        synchronized void chunk(String text) {
            if (!isSettled()) emit("chunk", text, 0);
        }
        synchronized void cancel() { finish(499, null, true); }
        synchronized void finish(int status, String body, boolean done) {
            if (!settled.compareAndSet(false, true)) return;
            if (done) emit("done", null, status);
            JSObject result = new JSObject();
            result.put("status", status);
            if (body != null) result.put("body", body);
            try { call.resolve(result); } finally { cleanup(); }
        }
        synchronized void fail(String message, int status) {
            if (!settled.compareAndSet(false, true)) return;
            emit("error", message, status);
            try { call.reject(message); } finally { cleanup(); }
        }
        private void emit(String type, String data, int status) {
            JSObject event = new JSObject();
            event.put("requestId", id);
            event.put("type", type);
            if (data != null) event.put("data", data);
            if (status > 0) event.put("status", status);
            notifyListeners("sncHttpEvent", event);
        }
        private void cleanup() {
            active.remove(id, this);
            if (deadline != null) deadline.cancel(false);
            final HttpURLConnection connected = connection;
            if (connected != null) {
                try { disconnects.execute(() -> { try { connected.disconnect(); } catch (Exception ignored) { } }); }
                catch (RejectedExecutionException ignored) { /* Worker finally also disconnects. */ }
            }
        }
    }

    private static String readAll(InputStream input, RequestState state) throws IOException {
        if (input == null) return "";
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        try (InputStream source = input) {
            int count;
            while (!state.isSettled() && (count = source.read(buffer)) != -1) {
                if (count > MAX_BODY_BYTES - output.size()) throw new RequestFailure("The API response exceeded the 32 MB text-response limit.");
                output.write(buffer, 0, count);
            }
        }
        if (state.isSettled()) return "";
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
    }

    private static final class RequestFailure extends IOException {
        RequestFailure(String message) { super(message); }
    }

    @Override
    protected void handleOnDestroy() {
        final RequestState[] pending;
        synchronized (active) {
            destroyed = true;
            pending = active.values().toArray(new RequestState[0]);
        }
        for (RequestState state : pending) state.cancel();
        pool.shutdownNow();
        deadlines.shutdownNow();
        disconnects.shutdown();
        super.handleOnDestroy();
    }
}
