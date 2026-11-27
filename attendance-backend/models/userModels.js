const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

// Sign-in is Google-only now. Password and WebAuthn/passkey fields were removed
// as part of the legacy cleanup (2026-10-17); recoverable from git history.
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    role: {
        type: String,
        enum: ["student", "teacher"],
        default: "student",
    },
    authProvider: {
        type: String,
        enum: ["google"],
        default: "google",
    },
    googleSubject: {
        type: String,
        unique: true,
        sparse: true,
    },
    deviceBinding: {
        fingerprint: String,
        publicKeyJwk: mongoose.Schema.Types.Mixed,
        approvedAt: Date,
        lastSeenAt: Date,
        // Dev mode only (DEV_MODE=true): other browsers the student signed in on,
        // each { fingerprint, publicKeyJwk, addedAt }. Ignored when dev mode is off.
        devKeys: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    },
    // Identity enrollment (Phase 8): ID card + live selfie → reference face.
    enrollment: {
        status: { type: String, enum: ["none", "pending", "verified", "rejected"], default: "none" },
        attempts: { type: Number, default: 0 },
        idCardMedia: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityMedia" },
        selfieMedia: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityMedia" }, // live frame awaiting review
        referenceFaceMedia: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityMedia" },
        scores: { liveness: Number, similarity: Number },
        idCheck: { faces: Number, hasText: Boolean, rollMatch: { type: Boolean, default: null } },
        reasons: [String],
        rejectReason: String,
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        decidedAt: Date,
        verifiedAt: Date,
    },
    consent: {
        version: String,
        acceptedAt: Date,
    },
});

// ✅ Generate JWT token
userSchema.methods.getJWTtoken = function () {
    return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE,
    });
};

const User = mongoose.model("User", userSchema);

module.exports = User;
