const cookieOptions = require("./cookieOptions");

// `extra` adds fields to the JSON body (e.g. the device challenge at sign-in).
const sendToken = (user, statusCode, res, extra = {}) => {
  const token = user.getJWTtoken();

  const options = cookieOptions(new Date(
    Date.now() + process.env.COOKIE_EXPIRE * 24 * 60 * 60 * 1000
  ));

  // The token travels only in the httpOnly cookie, never in the body, so page
  // scripts cannot read it.
  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    user: user.toObject ? user.toObject() : user,
    ...extra,
  });
};

module.exports = sendToken;
