package cn.sensenova.chat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 极简原生 HTTP 桥。
 *
 * 存在的唯一理由：Android WebView 里的 fetch 受同源策略约束，日日新的接口不会给
 * 浏览器发 CORS 头；而 Capacitor 官方的 CapacitorHttp 会把整个响应缓冲完才回调，
 * 拿不到流式增量。
 *
 * 所以这里只做三件事：发请求、把字节原样搬到 JS 层、支持中断。
 * SSE 切分和字段归一化一律留在 TypeScript（src/lib/sse.ts）里做，
 * 避免同一套解析逻辑在 Java / Node / TS 三处各写一份然后各自跑偏。
 */
@CapacitorPlugin(name = "SncHttp")
public class SncHttpPlugin extends Plugin {

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> cancelled = new ConcurrentHashMap<>();

    @PluginMethod
    public void request(final PluginCall call) {
        final String requestId = call.getString("requestId", "");
        final String urlStr = call.getString("url", "");
        final String method = call.getString("method", "POST");
        final String body = call.getString("body", "");
        final Boolean streamBoxed = call.getBoolean("stream", Boolean.FALSE);
        final boolean stream = streamBoxed != null && streamBoxed;
        final Integer timeoutBoxed = call.getInt("timeoutMs", 180000);
        final int timeoutMs = timeoutBoxed == null ? 180000 : timeoutBoxed;
        final JSObject headers = call.getObject("headers", new JSObject());

        pool.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    cancelled.remove(requestId);

                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod(method.toUpperCase());
                    conn.setConnectTimeout(Math.min(timeoutMs, 30000));
                    conn.setReadTimeout(timeoutMs);
                    conn.setInstanceFollowRedirects(true);

                    if (headers != null) {
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            String v = headers.getString(k);
                            if (v != null) conn.setRequestProperty(k, v);
                        }
                    }
                    if (stream) {
                        // 关掉压缩，避免中间层为了攒够一个压缩块而把增量憋住
                        conn.setRequestProperty("Accept-Encoding", "identity");
                        conn.setChunkedStreamingMode(0);
                    }

                    if (!"GET".equalsIgnoreCase(method)) {
                        conn.setDoOutput(true);
                        byte[] payload = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
                        conn.setFixedLengthStreamingMode(payload.length);
                        OutputStream os = conn.getOutputStream();
                        os.write(payload);
                        os.flush();
                        os.close();
                    }

                    active.put(requestId, conn);

                    int status = conn.getResponseCode();
                    InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();

                    // 出错 或 非流式：整包读回去，交给 JS 解析
                    if (status >= 400 || !stream || in == null) {
                        String text = readAll(in);
                        JSObject ret = new JSObject();
                        ret.put("status", status);
                        ret.put("body", text);
                        call.resolve(ret);
                        return;
                    }

                    // 流式：InputStreamReader 会自己缓存跨块的多字节 UTF-8 序列，
                    // 中文不会被切成乱码
                    InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8);
                    char[] cbuf = new char[2048];
                    int n;
                    while ((n = reader.read(cbuf)) != -1) {
                        if (Boolean.TRUE.equals(cancelled.get(requestId))) break;
                        emit(requestId, "chunk", new String(cbuf, 0, n));
                    }
                    try {
                        reader.close();
                    } catch (Exception ignored) {
                    }

                    emit(requestId, "done", null);
                    JSObject ret = new JSObject();
                    ret.put("status", status);
                    call.resolve(ret);

                } catch (Exception e) {
                    if (Boolean.TRUE.equals(cancelled.get(requestId))) {
                        // 用户主动停止，已经流出来的内容保留
                        emit(requestId, "done", null);
                        JSObject ret = new JSObject();
                        ret.put("status", 499);
                        call.resolve(ret);
                    } else {
                        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
                        emit(requestId, "error", msg);
                        call.reject(msg);
                    }
                } finally {
                    active.remove(requestId);
                    cancelled.remove(requestId);
                    if (conn != null) {
                        try {
                            conn.disconnect();
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
        });
    }

    @PluginMethod
    public void abort(final PluginCall call) {
        final String requestId = call.getString("requestId", "");
        cancelled.put(requestId, Boolean.TRUE);
        pool.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = active.get(requestId);
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (Exception ignored) {
                    }
                }
            }
        });
        call.resolve();
    }

    private void emit(String requestId, String type, String data) {
        JSObject ev = new JSObject();
        ev.put("requestId", requestId);
        ev.put("type", type);
        if (data != null) ev.put("data", data);
        notifyListeners("sncHttpEvent", ev);
    }

    private static String readAll(InputStream in) {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        try {
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        } catch (Exception ignored) {
        } finally {
            try {
                in.close();
            } catch (Exception ignored) {
            }
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
