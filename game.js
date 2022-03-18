const NUM_BUCKETS = 5;

class Game {
    constructor (canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.canvas.width = 800;
        this.canvas.height = 600;

        this.buckets = [];
        for (let i = 0; i < NUM_BUCKETS; i++) {
            this.buckets.push(i);
        }

        document.body.addEventListener('keydown', event => {
            if (!Object.prototype.hasOwnProperty.call(keysToBuckets, event.key)) return;

            const bucket = keysToBuckets[event.key];
            console.log(bucket)
            if (bucket >= NUM_BUCKETS - 1) return;
            this.swapBuckets(this.buckets, bucket);
        });

        const keysToBuckets = {
            z: 0,
            x: 1,
            c: 2,
            v: 3,
            b: 4,
            n: 5,
            m: 6
        };

        this.sequence = [];
        this.droppedBlocks = [];

        window.setInterval(this.step.bind(this), 1000 / 60);
    }

    swapBuckets(buckets, startIndex) {
        const tmp = buckets[startIndex];
        buckets[startIndex] = buckets[startIndex + 1];
        buckets[startIndex + 1] = tmp;
        return buckets;
    }

    step () {
        this.draw();
    }

    draw () {
        const {ctx} = this;
        const {width, height} = this.canvas;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, width, height);

        const BUCKET_HEIGHT = 80;
        for (let i = 0; i < NUM_BUCKETS; i++) {
            ctx.fillStyle = `hsl(${this.buckets[i] / NUM_BUCKETS}turn 100% 50%)`;
            ctx.fillRect(i * (width / NUM_BUCKETS), height - BUCKET_HEIGHT, (width / NUM_BUCKETS), BUCKET_HEIGHT);
        }
    }
}

export default Game;
