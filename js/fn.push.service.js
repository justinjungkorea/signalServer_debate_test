
(function( global ) {
    function Push( options ) {
        console.log( 'options', options )
        if ( options.type === 'G_PUSH' ) {

            this.hostname = options.hostname;
            this.port = options.port;
            this.path = options.path;
            this.pushData = options.pushData;

            //return this;

        } 
        
        if ( options.type === 'FCM_PUSH' ) {

            this.serverKey = options.serverKey;
            this.clientTocken = options.clientTocken;
            this.data = options.data;
            this.notification = options.notification;
            this.priority = options.priority;
            this.packageName = options.packageName;

            //return this;

        }

    }

    Push.prototype.sendGPush = function( callback ) {

        if ( typeof callback !== 'function') return;
        
            const http = require( 'http' )
        
            let postData = JSON.stringify( this.pushData ),
                postReq  = null;

            let postOption = {
                hostname: this.hostname,
                port: this.port,
                path: this.path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': postData.length			
                }
            }
        
            postReq = http.request( postOption, function( res ){
        
                res.setEncoding('utf8');
                res.on( 'data', function( resData ) {
                    callback( null, resData )
                });		
            })
        
            postReq.on( 'error', function(e) {
                callback( e.message )
            });
        
            postReq.write( postData );
            postReq.end();
    }

    Push.prototype.sendFCMPush = function( callback ) {
        const FCM = require( 'fcm-node' );

        const push_data = {
            to: this.clientTocken,
            notification: this.notification,
            priority: this.priority,
            restricted_package_name: this.packageName,
            data: this.data
         }

        const fcm = new FCM( this.serverKey );
        fcm.send( push_data, function( err, res ) {
        
            if ( err ) {
                callback( err )
                return;
            }

            callback( null, res );
        });

        

        
    }

    module.exports = Push

})( this )