class ApiResponse{
    constructor(statusCode,data,message="Success"){
        this.statusCode=statusCode
        this.data=data;
        this.message=message
        this.success=statusCode < 400 //?? boolean code if(statusCode<400){true} else {false}
    }
}

export { ApiResponse }