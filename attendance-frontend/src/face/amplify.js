// AWS Amplify set-up for the Face Liveness stream (Phase 7). The browser only
// gets Cognito guest credentials that can start a liveness stream; creating
// sessions and reading results always happens on our backend.
import { Amplify } from "aws-amplify";

export const AWS_REGION = process.env.REACT_APP_AWS_REGION || "ap-south-1";
const IDENTITY_POOL_ID = process.env.REACT_APP_AWS_IDENTITY_POOL_ID || "";

let configured = false;

export const faceCheckAvailable = () => Boolean(IDENTITY_POOL_ID);

export const configureAmplify = () => {
  if (configured || !IDENTITY_POOL_ID) return configured;
  Amplify.configure({ Auth: { Cognito: { identityPoolId: IDENTITY_POOL_ID, allowGuestAccess: true } } });
  configured = true;
  return configured;
};
