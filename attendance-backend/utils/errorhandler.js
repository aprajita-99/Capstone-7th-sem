class ErrorHandler extends Error{
    // errorCode: optional machine-readable reason the frontend can branch on
    // (e.g. "not_enrolled"); sent as `code` in the JSON error response.
    constructor(message,statuscode,errorCode){
        super(message);
        this.statuscode=statuscode
        this.errorCode=errorCode

        Error.captureStackTrace(this,this.constructor);
    }
}

module.exports= ErrorHandler;