package dev.anyai.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Copies a verified, bounded download to a document chosen by the user. */
@CapacitorPlugin(name = "WickrunFiles")
public class WickrunFilesPlugin extends Plugin {
    private static final int CHUNK_BYTES = 512 * 1024;
    private static final long MAX_BYTES = 100L * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Transfer active;

    private static final class Transfer {
        final String id, name, mime, sha256;
        final long size;
        final File file;
        final MessageDigest digest;
        FileOutputStream output;
        long received;
        int nextIndex;
        boolean verified;
        volatile boolean cancelled;
        PluginCall finishCall;
        Transfer(String id, String name, String mime, long size, String sha256, File file) throws Exception {
            this.id = id; this.name = name; this.mime = mime; this.size = size; this.sha256 = sha256; this.file = file;
            this.digest = MessageDigest.getInstance("SHA-256");
            this.output = new FileOutputStream(file);
        }
    }

    private File tempDir() {
        File dir = new File(getContext().getCacheDir(), "wickrun-verified-downloads");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Download cache unavailable");
        return dir;
    }
    private static String cleanName(String name) {
        if (name == null) throw new IllegalArgumentException("Invalid file name");
        String value = name.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        if (value.isEmpty() || value.equals(".") || value.equals("..") || value.length() > 180)
            throw new IllegalArgumentException("Invalid file name");
        return value;
    }
    private static String cleanMime(String mime) {
        if (mime == null || !mime.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]{1,100}"))
            return "application/octet-stream";
        return mime;
    }
    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) value.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return value.toString();
    }
    private Transfer matching(PluginCall call) {
        String id = call.getString("id");
        if (active == null || id == null || !active.id.equals(id)) throw new IllegalArgumentException("Download session expired");
        return active;
    }
    private void discard(Transfer transfer) {
        if (transfer == null) return;
        try { if (transfer.output != null) transfer.output.close(); } catch (Exception ignored) {}
        transfer.file.delete();
        if (active == transfer) active = null;
    }

    @Override public void load() {
        super.load();
        // A process killed while the picker is open must not leave old verified bytes in cache.
        File[] old = tempDir().listFiles();
        if (old != null) for (File file : old) if (file.getName().startsWith("download-") && file.getName().endsWith(".part")) file.delete();
    }

    @PluginMethod public void downloadBegin(PluginCall call) {
        worker.execute(() -> {
            try {
                Long size = call.getLong("size");
                String sha = call.getString("sha256");
                if (size == null || size < 0 || size > MAX_BYTES || sha == null || !sha.matches("[a-f0-9]{64}"))
                    throw new IllegalArgumentException("Invalid download manifest");
                if (active != null) throw new IllegalStateException("Another download is being saved");
                String name = cleanName(call.getString("name"));
                String mime = cleanMime(call.getString("mime"));
                File file = File.createTempFile("download-", ".part", tempDir());
                try {
                    active = new Transfer(UUID.randomUUID().toString(), name, mime, size, sha, file);
                } catch (Exception error) { file.delete(); throw error; }
                JSObject result = new JSObject();
                result.put("id", active.id);
                call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }

    @PluginMethod public void downloadChunk(PluginCall call) {
        worker.execute(() -> {
            Transfer transfer = null;
            try {
                transfer = matching(call);
                Integer index = call.getInt("index");
                String data = call.getString("data");
                if (transfer.verified || transfer.cancelled || index == null || index != transfer.nextIndex || data == null ||
                    data.length() > ((CHUNK_BYTES + 2) / 3) * 4 || data.length() % 4 != 0)
                    throw new IllegalArgumentException("Invalid download chunk");
                byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
                long remaining = transfer.size - transfer.received;
                if (bytes.length != Math.min(CHUNK_BYTES, remaining) ||
                    !Base64.encodeToString(bytes, Base64.NO_WRAP).equals(data))
                    throw new IllegalArgumentException("Invalid download chunk");
                transfer.output.write(bytes);
                transfer.digest.update(bytes);
                transfer.received += bytes.length;
                transfer.nextIndex++;
                call.resolve();
            } catch (Exception error) {
                discard(transfer);
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod public void downloadFinish(PluginCall call) {
        worker.execute(() -> {
            Transfer transfer = null;
            try {
                transfer = matching(call);
                if (transfer.verified || transfer.cancelled || transfer.received != transfer.size)
                    throw new IllegalArgumentException("Incomplete download");
                transfer.output.close();
                transfer.output = null;
                if (!hex(transfer.digest.digest()).equals(transfer.sha256))
                    throw new IllegalArgumentException("Download checksum mismatch");
                transfer.verified = true;
                transfer.finishCall = call;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(transfer.mime);
                intent.putExtra(Intent.EXTRA_TITLE, transfer.name);
                Transfer pending = transfer;
                getActivity().runOnUiThread(() -> {
                    try {
                        if (pending.cancelled) throw new IllegalStateException("Save cancelled");
                        startActivityForResult(call, intent, "saveDocument");
                    }
                    catch (Exception error) {
                        worker.execute(() -> { discard(pending); call.reject("Cannot open document picker"); });
                    }
                });
            } catch (Exception error) {
                discard(transfer);
                call.reject(error.getMessage());
            }
        });
    }

    @ActivityCallback private void saveDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        worker.execute(() -> {
            Transfer transfer = active;
            if (transfer == null || transfer.finishCall != call || !transfer.verified) {
                call.reject("Download session expired");
                return;
            }
            if (transfer.cancelled || result.getResultCode() != Activity.RESULT_OK || result.getData() == null ||
                result.getData().getData() == null) {
                discard(transfer);
                call.reject("Save cancelled");
                return;
            }
            Uri destination = result.getData().getData();
            long copied = 0;
            try {
                if (!"content".equals(destination.getScheme())) throw new IllegalArgumentException("Invalid save location");
                try (InputStream input = new FileInputStream(transfer.file);
                     OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new IllegalStateException("Save location unavailable");
                    byte[] buffer = new byte[64 * 1024];
                    int length;
                    while ((length = input.read(buffer)) != -1) {
                        if (transfer.cancelled) throw new IllegalStateException("Save cancelled");
                        output.write(buffer, 0, length);
                        copied += length;
                    }
                    output.flush();
                }
                if (transfer.cancelled || copied != transfer.size) throw new IllegalStateException("Saved size mismatch");
                JSObject value = new JSObject();
                value.put("saved", true);
                call.resolve(value);
            } catch (Exception error) {
                call.reject(transfer.cancelled ? "Save cancelled" : "Cannot save verified download");
            } finally { discard(transfer); }
        });
    }

    @PluginMethod public void downloadAbort(PluginCall call) {
        String id = call.getString("id");
        Transfer pending = active;
        if (pending != null && pending.id.equals(id)) pending.cancelled = true;
        worker.execute(() -> {
            try {
                if (pending != null && active == pending) {
                    if (pending.finishCall != null) pending.finishCall.reject("Save cancelled");
                    discard(pending);
                }
                call.resolve();
            } catch (Exception error) { call.resolve(); }
        });
    }

    @Override protected void handleOnDestroy() {
        Transfer pending = active;
        if (pending != null) pending.cancelled = true;
        worker.execute(() -> discard(active));
        worker.shutdown();
        super.handleOnDestroy();
    }
}
