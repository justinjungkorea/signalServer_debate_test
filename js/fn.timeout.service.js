

const Scheduler = (function() {

    let schedule = require( 'node-schedule' );
    let events = require( 'events' );

    

    function Scheduler( option ) {

        if ( typeof option === 'undefined' ) {
            option = {};
        }
        
        this.timeout = option.timeout || 10; // second
        this.process = null;

        events.EventEmitter.call( this );
    }

    Scheduler.prototype.__proto__ = events.EventEmitter.prototype;

    Scheduler.prototype.start = function( callback ) {
        let over = 0;

        this.process = schedule.scheduleJob( '*/1 * * * * *', function( fireData ){
            
            over ++;
            ongoing.call( this, fireData );

            if ( over === this.timeout ) {

                over = 0;
                stopFromTimeout.call( this, fireData );
                return;

            } 
        }.bind( this ));
    }

    function ongoing() {
        this.emit( 'data' );
    }

    function stopFromTimeout( fireData ) {

        this.process.cancel();
        this.process = null;
    
        this.emit( 'timeout', fireData );
    }
        
    /**
     * stop from system, not timeout
     */
    Scheduler.prototype.stop = function() {
        
        this.process.cancel();
        this.process = null;

        this.emit( 'stop' );

    }

    return Scheduler;
})();


module.exports = {
    Scheduler
}
