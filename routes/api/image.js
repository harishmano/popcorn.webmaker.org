var fs = require( "fs" ),
    metrics = require( "../../lib/metrics" ),
    s3 = require( "../../lib/s3" ),
    uuid = require( "node-uuid" );

module.exports = function( req, res ) {
  var image = req.files.image,
      validMimeTypes = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif"
      },
      extension = validMimeTypes[ image.type ] ? validMimeTypes[ image.type ] : "",
      s3Path = "/user_uploads/" + uuid.v4() + extension;

  var s3req = s3.put( s3Path, {
    "x-amz-acl": "public-read",
    "Content-Length": image.size,
    "Content-Type": image.type
  }).on( "error", function( err ) {
    res.json( 500, { error: "S3.putImage returned " + err } );
    metrics.increment( 'error.save.store-image' );
  }).on( "response", function( s3res ) {
    if ( s3res.statusCode !== 200 ) {
      res.json( 500, { error: "Failed to upload image. Uploading file failed." } );
      metrics.increment( 'error.save.store-image' );
      return;
    }

    res.json( { url: s3.url( s3Path ) } );
    metrics.increment( 'project.images-upload' );
  });

  fs.createReadStream( image.path ).pipe( s3req );
};
