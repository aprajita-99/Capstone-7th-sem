const mongoose = require("mongoose");

// One-time nonce a student's device signs to prove it holds its private key.
// Single use; MongoDB deletes it shortly after it expires (TTL index).
const deviceChallengeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ["bind", "claim", "face", "neighbour"],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: Date,
  },
  { timestamps: true }
);

deviceChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("DeviceChallenge", deviceChallengeSchema);
