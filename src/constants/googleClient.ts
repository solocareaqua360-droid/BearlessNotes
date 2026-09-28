// The OAuth client this app signs in as, for Drive.
//
// It lives here, alone, because BOTH sides need it and neither may
// import the other: googleClient.ts pulls in the native Google module,
// which does not exist in a browser, and driveToken.web.ts is only ever
// bundled for one. Copying the string into both is how it ends up
// mistyped in one of them - which is exactly what happened, and Google
// answered "The OAuth client was not found".
//
// A client id is public by design; it is in every APK already. The
// SECRET that goes with it is not here and never will be.
export const GOOGLE_CLIENT_ID = '502504187063-rvq5euk4tragb83sg99o0d04g215rh1u.apps.googleusercontent.com';
