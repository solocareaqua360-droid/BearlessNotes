// The Google Cloud project «video-bookmark-app» (number 517842042497), the
// ANDROID OAuth client made for this app's package + signing key (2026-11-08).
// It is public by design (no secret): it only works with this exact app.
export const GOOGLE_ANDROID_CLIENT_ID = "517842042497-q9prjb6h04u9toh3lhdfq3ac1crm59rn.apps.googleusercontent.com";
// The only thing asked of the account: to READ the YouTube subscriptions.
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];
// Google sends the user back to the app on the app's own package name as the scheme
// (the client has «custom URI scheme» enabled; app.json lists it among the schemes).
export const GOOGLE_REDIRECT_URI = "com.bearlessnotes.app:/oauth2redirect";
