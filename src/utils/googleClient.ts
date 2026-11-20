import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GOOGLE_CLIENT_ID } from '../constants/googleClient';

// One configure call for both things a Google sign-in has to do here, and
// its own module so neither side has to import the other (googleDrive
// already imports firebase, so firebase importing googleDrive would close
// a circle).
//
// The client ID is deliberately NOT the Firebase project's own. Drive was
// set up in a separate Cloud project long before this, and `drive.file`
// grants access to files created by THAT project - sign in as anyone else
// and every backup already up there becomes invisible. So the app keeps
// signing in as the Drive project's client, and Firebase is told to accept
// its tokens (Authentication → Google → "Safelist client IDs from external
// projects"). A client ID is public by design; this is not a secret.
// Written here rather than read from .env, and deliberately. A client ID is
// public by design - it is in every APK already - so there is nothing to
// hide, and an env var bought only one thing: a way for this to arrive
// EMPTY. Which it did: `eas update --environment preview` takes variables
// from the EAS environment, not the local .env, and that environment has
// none - so the published bundle asked Google for a token with no audience
// and got "Google не повернув токен" with nothing to point at.
//
// The env var still overrides it, for anyone running against another
// project.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || GOOGLE_CLIENT_ID;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

let configured = false;

export function ensureGoogleConfigured() {
  if (configured) return;
  GoogleSignin.configure({
    // Without this the sign-in returns no idToken at all, and Firebase has
    // nothing to verify - which is the whole reason the Web client above
    // had to exist.
    webClientId: WEB_CLIENT_ID,
    scopes: [DRIVE_SCOPE],
  });
  configured = true;
}

export { DRIVE_SCOPE };
