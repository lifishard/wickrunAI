package dev.anyai.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Device-local filtering, applied before any observed text enters storage. */
final class WickrunContextPrivacy {
    private static final Pattern AUTH = Pattern.compile("(?i)password|passcode|one[- ]time (?:code|password)|\\botp\\b|api[ _-]?key|secret[ _-]?key|private[ _-]?key|access[ _-]?token|refresh[ _-]?token|bearer\\s+[A-Za-z0-9._-]+|\\b(?:sk-|ghp_)[A-Za-z0-9_-]{12,}\\b|\\bAKIA[A-Z0-9]{16}\\b|密码|验证码|密钥|口令|令牌");
    private static final Pattern CONTACT = Pattern.compile("(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|(?<!\\d)\\+?\\d[\\d ()-]{7,}\\d(?!\\d)");
    private static final Pattern FINANCIAL = Pattern.compile("(?i)\\b(?:iban|routing number|account number)\\b|银行账号|银行卡号|账户余额|(?<!\\d)(?:\\d[ -]?){13,19}(?!\\d)");
    private static final Pattern HEALTH = Pattern.compile("(?i)诊断|病历|处方|medical record|diagnosis|prescription");
    private static final String[] CATEGORIES = { "contact", "financial", "health" };
    private final List<String> excludedTerms;
    private final List<String> encryptedOnlyTerms;
    private final String contact;
    private final String financial;
    private final String health;

    static final class Filtered {
        final String publicText;
        final String encryptedOnlyText;
        Filtered(String publicText, String encryptedOnlyText) { this.publicText = publicText; this.encryptedOnlyText = encryptedOnlyText; }
    }
    private WickrunContextPrivacy(List<String> excludedTerms, List<String> encryptedOnlyTerms, String contact, String financial, String health) {
        this.excludedTerms = excludedTerms; this.encryptedOnlyTerms = encryptedOnlyTerms;
        this.contact = contact; this.financial = financial; this.health = health;
    }
    static WickrunContextPrivacy defaults() { return new WickrunContextPrivacy(new ArrayList<>(), new ArrayList<>(), "redact", "redact", "exclude"); }
    private static List<String> terms(JSONObject input, String key) {
        JSONArray values = input.optJSONArray(key);
        if (values == null) return new ArrayList<>();
        if (values.length() > 40) throw new IllegalArgumentException("Too many privacy terms.");
        List<String> result = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            Object value = values.opt(i);
            if (!(value instanceof String)) throw new IllegalArgumentException("Invalid privacy term.");
            String term = ((String) value).trim().toLowerCase(Locale.ROOT);
            if (term.isEmpty() || term.length() > 80) throw new IllegalArgumentException("Privacy term must be 1–80 characters.");
            if (!result.contains(term)) result.add(term);
        }
        return result;
    }
    private static String category(JSONObject input, String key, String fallback) {
        String value = input.optString(key, fallback);
        if (!value.equals("exclude") && !value.equals("encrypt-only") && !value.equals("redact"))
            throw new IllegalArgumentException("Invalid privacy category rule.");
        return value;
    }
    static WickrunContextPrivacy from(JSONObject input) {
        if (input == null) return defaults();
        JSONObject categories = input.optJSONObject("categories");
        if (categories == null) categories = new JSONObject();
        return new WickrunContextPrivacy(terms(input, "excludedTerms"), terms(input, "encryptedOnlyTerms"),
                category(categories, CATEGORIES[0], "redact"), category(categories, CATEGORIES[1], "redact"), category(categories, CATEGORIES[2], "exclude"));
    }
    JSONObject json() {
        JSONObject value = new JSONObject();JSONObject categories = new JSONObject();
        try {
            value.put("excludedTerms", new JSONArray(excludedTerms));
            value.put("encryptedOnlyTerms", new JSONArray(encryptedOnlyTerms));
            categories.put("contact", contact);categories.put("financial", financial);categories.put("health", health);
            value.put("categories", categories);value.put("encryptedStorage", true);
        } catch (Exception ignored) { /* Values were validated at construction. */ }
        return value;
    }
    private static boolean hasTerm(String lower, List<String> terms) {
        for (String term : terms) if (lower.contains(term)) return true;
        return false;
    }
    private static String actionFor(String line, Pattern pattern, String action, String current) {
        if (current.equals("exclude") || !pattern.matcher(line).find()) return current;
        if (action.equals("exclude")) return "exclude";
        if (action.equals("encrypt-only")) return "encrypt-only";
        return current;
    }
    Filtered apply(String text) {
        StringBuilder publicText = new StringBuilder(), privateText = new StringBuilder();
        for (String raw : text.split("\\r?\\n", -1)) {
            String line = raw.replaceAll("\\s+", " ").trim();
            if (line.isEmpty() || AUTH.matcher(line).find()) continue;
            String lower = line.toLowerCase(Locale.ROOT);
            if (hasTerm(lower, excludedTerms)) continue;
            String action = hasTerm(lower, encryptedOnlyTerms) ? "encrypt-only" : "keep";
            action = actionFor(line, CONTACT, contact, action);
            action = actionFor(line, FINANCIAL, financial, action);
            action = actionFor(line, HEALTH, health, action);
            if (action.equals("exclude")) continue;
            if (action.equals("encrypt-only")) { append(privateText, line); continue; }
            if (CONTACT.matcher(line).find() && contact.equals("redact")) line = CONTACT.matcher(line).replaceAll("[联系方式已隐藏]");
            if (FINANCIAL.matcher(line).find() && financial.equals("redact")) line = FINANCIAL.matcher(line).replaceAll("[财务信息已隐藏]");
            if (HEALTH.matcher(line).find() && health.equals("redact")) line = HEALTH.matcher(line).replaceAll("[健康信息已隐藏]");
            append(publicText, line);
        }
        return new Filtered(publicText.toString(), privateText.toString());
    }
    private static void append(StringBuilder builder, String line) { if (builder.length() > 0) builder.append('\n');builder.append(line); }
}
