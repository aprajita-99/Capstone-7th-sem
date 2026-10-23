// Single-use lookup of a user's AWS liveness session for one purpose.
const FaceSession = require("../models/faceSessionModels");

const consumeFaceSession = async ({ awsSessionId, user, purpose }) =>
  FaceSession.findOneAndUpdate(
    { awsSessionId: String(awsSessionId || ""), user: user._id, purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

module.exports = { consumeFaceSession };
