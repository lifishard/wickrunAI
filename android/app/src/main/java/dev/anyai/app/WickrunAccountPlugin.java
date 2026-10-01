package dev.anyai.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Account credentials never cross the WebView bridge. Only fixed cloud routes are exposed. */
@CapacitorPlugin(name="WickrunAccount")
public class WickrunAccountPlugin extends Plugin {
    private static final String ORIGIN="https://wickrunai.com", ALIAS="wickrun.account.v1";
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private interface Operation { JSONObject run() throws Exception; }
    private static class HttpFailure extends Exception {
        final int status;
        HttpFailure(int status) { super(status==401?"登录已过期，请退出后重新登录。":"云端请求失败，请稍后重试。");this.status=status; }
    }
    private void execute(PluginCall call, Operation operation) {
        worker.execute(()->{try { call.resolve(new JSObject(operation.run().toString())); }
            catch(HttpFailure e){call.reject(e.getMessage(),String.valueOf(e.status));}
            catch(Exception e){call.reject("账号操作未完成，请检查网络后重试。");}});
    }
    private SecretKey key() throws Exception {
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        if(!keys.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
        }
        return (SecretKey)keys.getKey(ALIAS,null);
    }
    private JSONObject load(String name) throws Exception {
        String value=getContext().getSharedPreferences("wickrun_accounts",Context.MODE_PRIVATE).getString(name,null);
        if(value==null)return null;
        String[] pieces=value.split(":",-1);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(pieces[0],Base64.NO_WRAP)));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(pieces[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    private void save(String name, JSONObject value) throws Exception {
        android.content.SharedPreferences.Editor editor=getContext().getSharedPreferences("wickrun_accounts",Context.MODE_PRIVATE).edit();
        if(value==null)editor.remove(name);
        else {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            editor.putString(name,Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        }
        if(!editor.commit())throw new Exception("Storage unavailable");
    }
    private JSONObject request(String path,String method,JSONObject body,String token) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(ORIGIN+path).openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(20000);
        connection.setRequestMethod(method);connection.setRequestProperty("Accept","application/json");
        if(token!=null)connection.setRequestProperty("Authorization","Bearer "+token);
        try {
            if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();if(status<200||status>=300)throw new HttpFailure(status);
            try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] chunk=new byte[8192];int size;while((size=in.read(chunk))!=-1){out.write(chunk,0,size);if(out.size()>12*1024*1024)throw new Exception("Response too large");}
                return new JSONObject(out.toString("UTF-8"));
            }
        } finally {connection.disconnect();}
    }
    private static String url64(byte[] bytes){return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
    private JSONObject pending() throws Exception {
        JSONObject value=load("pending");
        if(value!=null && value.getLong("expires")<=System.currentTimeMillis()){save("pending",null);return null;}
        return value;
    }
    private JSONObject state() throws Exception {
        JSONObject active=load("active"),ready=load("ready"),pending=pending();
        return new JSONObject().put("origin",ORIGIN).put("user",active==null?JSONObject.NULL:active.getJSONObject("user"))
            .put("ready",ready==null?JSONObject.NULL:ready.getJSONObject("user"))
            .put("pending",pending==null?JSONObject.NULL:new JSONObject().put("code",pending.getString("code")).put("expires",pending.getLong("expires")));
    }
    @PluginMethod public void state(PluginCall call){execute(call,()->state());}
    @PluginMethod public void login(PluginCall call){execute(call,()->{
        if(load("active")!=null||load("ready")!=null)throw new Exception("Finish the pending account switch first");
        byte[] random=new byte[32];new SecureRandom().nextBytes(random);String verifier=url64(random);
        String challenge=url64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        JSONObject result=request("/api/cloud/desktop/start","POST",new JSONObject().put("challenge",challenge).put("client","android"),null);
        String id=result.getString("requestId"),loginUrl=result.getString("loginUrl");
        if(!id.matches("[a-f0-9]{64}")||!loginUrl.equals(ORIGIN+"/api/cloud/desktop/approve?request="+id))throw new Exception("Untrusted login URL");
        JSONObject pending=new JSONObject().put("requestId",id).put("verifier",verifier).put("code",result.getString("code")).put("expires",System.currentTimeMillis()+300000);
        save("ready",null);save("pending",pending);
        java.util.concurrent.CompletableFuture<Void> opened=new java.util.concurrent.CompletableFuture<>();
        getActivity().runOnUiThread(()->{try{getActivity().startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(loginUrl)));opened.complete(null);}catch(Exception e){opened.completeExceptionally(e);}});
        try{opened.get(5,java.util.concurrent.TimeUnit.SECONDS);}catch(Exception e){save("pending",null);throw e;}
        return new JSONObject().put("code",pending.getString("code")).put("expires",pending.getLong("expires"));
    });}
    @PluginMethod public void poll(PluginCall call){execute(call,()->{
        if(load("ready")!=null)return new JSONObject().put("ready",true);
        JSONObject pending=pending();if(pending==null)return new JSONObject().put("pending",false);
        JSONObject result=request("/api/cloud/desktop/token","POST",new JSONObject().put("requestId",pending.getString("requestId")).put("verifier",pending.getString("verifier")),null);
        if(result.optBoolean("pending"))return result;
        if(!result.getString("token").matches("[\\w-]{43}")||result.getJSONObject("user").getString("id").isEmpty())throw new Exception("Invalid account response");
        save("ready",result);save("pending",null);return new JSONObject().put("ready",true);
    });}
    @PluginMethod public void cancel(PluginCall call){execute(call,()->{
        JSONObject ready=load("ready");
        if(ready!=null){try{request("/api/cloud/desktop/logout","POST",new JSONObject(),ready.getString("token"));}catch(HttpFailure e){if(e.status!=401)throw e;}}
        save("pending",null);save("ready",null);return new JSONObject();});}
    @PluginMethod public void activate(PluginCall call){execute(call,()->{
        JSONObject ready=load("ready");if(ready==null||load("active")!=null)throw new Exception("No pending account");
        save("active",ready);save("ready",null);return new JSONObject();
    });}
    @PluginMethod public void logout(PluginCall call){execute(call,()->{
        JSONObject active=load("active");
        if(active!=null){try{request("/api/cloud/desktop/logout","POST",new JSONObject(),active.getString("token"));}catch(HttpFailure e){if(e.status!=401)throw e;}}
        save("active",null);save("ready",null);save("pending",null);return new JSONObject();
    });}
    @PluginMethod public void call(PluginCall call){execute(call,()->{
        String action=call.getString("action","");JSONObject input=call.getObject("input",new JSObject());
        JSONObject active=load("active");String token=active==null?null:active.getString("token");
        String route,method="GET";JSONObject body=null;
        switch(action){
            case "status":route="/api/cloud/status";break;
            case "read":route="/api/cloud/data";break;
            case "write":route="/api/cloud/data";method="PUT";body=input;break;
            case "keys":route="/api/cloud/keys";break;
            case "collaboration":route="/api/collaboration";method="POST";body=input;break;
            case "keyGet":case "keySet":case "keyDelete":
                String id=input.optString("id");if(!id.matches("[\\w:-]{1,160}"))throw new Exception("Invalid profile");
                route="/api/cloud/keys/"+Uri.encode(id);method=action.equals("keyGet")?"GET":action.equals("keySet")?"PUT":"DELETE";body=action.equals("keySet")?input:null;break;
            default:throw new Exception("Unsupported cloud action");
        }
        if(!action.equals("status")&&active==null){
            if(!action.equals("collaboration"))throw new HttpFailure(401);
            String operation=input.optString("operation","");
            boolean guestRead=operation.equals("state")||operation.equals("get")||operation.equals("openLink")||operation.equals("getHistory");
            boolean guestComment=operation.equals("comment")&&input.optJSONObject("input")!=null&&
                input.optJSONObject("input").optString("token","").matches("[A-Za-z0-9_-]{43}");
            if(!guestRead&&!guestComment)throw new HttpFailure(401);
        }
        JSONObject result=request(route,method,body,token);
        if(action.equals("status")&&active!=null) {
            if(result.isNull("user"))throw new HttpFailure(401);
            if(!active.getJSONObject("user").getString("id").equals(result.getJSONObject("user").getString("id")))throw new HttpFailure(401);
        }
        return result;
    });}
    @Override protected void handleOnNewIntent(Intent intent){
        Uri uri=intent.getData();
        if(uri!=null&&"wickrunai".equals(uri.getScheme())&&"auth".equals(uri.getHost())&&"/complete".equals(uri.getPath()))notifyListeners("loginReturn",new JSObject(),true);
    }
    @Override protected void handleOnResume(){notifyListeners("loginReturn",new JSObject(),true);}
}
