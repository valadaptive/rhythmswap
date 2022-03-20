import {html, render, Component} from 'https://unpkg.com/htm@3.1.0/preact/standalone.module.js';

class ButtonGroup extends Component {
    constructor (props) {
        super(props);
    }

    clickButton (id) {
        if (this.props.onChange) {
            this.props.onChange(id);
        }
    }

    render () {
        const {options, selected} = this.props;
        return html`
            <div class="button-group">${
                options.map(({id, value}) => html`
                    <div key=${id} class="group-button ${id === selected ? 'selected' : ''}" onClick=${this.clickButton.bind(this, id)}>
                        ${value}
                    </div>
                `)
            }</div>
        `
    }
}

const PEAK_RES = 256;

const BUTTONS = ['z', 'x', 'c', 'v'];

const __rand = new Uint32Array(1);
const id = () => {
    return ('00000000' + crypto.getRandomValues(__rand)[0].toString(16)).slice(-8);
};

class App extends Component {
    constructor (props) {
        super(props);

        this.state = {
            audioBuffer: null,
            audioData: null,
            audioPeaks: null,
            bpm: 100,
            firstBeatOffset: 0,
            quantize: 4,
            volume: 1,
            inputMode: 'input',
            calibrationMeasurements: null,
            bpmMeasurements: null,
            latency: 0,
            error: null,
            loading: false
        };
        this.requestId = null;
        this.audioContext = new AudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.canvasMousePosition = [0, 0];
        this.playing = false;
        this.audioSource = null;
        this.playbackStartTime = null;

        this.scrollStart = 0;
        this.scrollEnd = 1;
        this.currentTime = 0;

        this.mouseButtons = [false, false, false, false, false];
        this.mouseClicked = [false, false, false, false, false];
        this.keysPressed = new Set();

        this.dragging = false;
        this.dragStarted = false;
        this.dragEnded = false;
        this.dragStart = [0, 0];
        this.draggedItem = null;

        this.chart = {};

        this.setSong = this.setSong.bind(this);
        this.setBPM = this.setBPM.bind(this);
        this.setFirstBeatOffset = this.setFirstBeatOffset.bind(this);
        this.setFirstBeatOffsetToCursor = this.setFirstBeatOffsetToCursor.bind(this);
        this.setQuantize = this.setQuantize.bind(this);
        this.setVolume = this.setVolume.bind(this);
        this.setInputMode = this.setInputMode.bind(this);
        this.setLatency = this.setLatency.bind(this);
        this.setCanvas = this.setCanvas.bind(this);
        this.setCanvasContainer = this.setCanvasContainer.bind(this);
        this.update = this.update.bind(this);

        this.onCanvasScroll = this.onCanvasScroll.bind(this);
        this.onCanvasMouseMove = this.onCanvasMouseMove.bind(this);
        this.onCanvasKeyDown = this.onCanvasKeyDown.bind(this);
        this.onCanvasMouseDown = this.onCanvasMouseDown.bind(this);
        this.onCanvasMouseUp = this.onCanvasMouseUp.bind(this);
    }

    static constructPeaks (audioData) {
        const peakBuf = new Float32Array(Math.ceil(audioData.length / PEAK_RES));

        let i = 0;
        let len = audioData.length;
        let numChunks = Math.floor(len / PEAK_RES);
        let highest = 0;
        for (let i = 0; i < numChunks; i++) {
            const offset = i * PEAK_RES;
            let max = 0;
            for (let j = 0; j < PEAK_RES; j++) {
                const absVal = Math.abs(audioData[offset + j]);
                max = absVal > max ? absVal : max;
            }
            peakBuf[i] = max;
            highest = max > highest ? max : highest;
        }
        if (numChunks * PEAK_RES !== len) {
            const offset = numChunks * PEAK_RES;
            let max = 0;
            for (let j = 0; j < len - offset; j++) {
                const absVal = Math.abs(audioData[offset + j]);
                max = absVal > max ? absVal : max;
            }
            peakBuf[peakBuf.length - 1] = max;
            highest = max > highest ? max : highest;
        }

        return {audioPeaks: peakBuf, highest};
    }

    setSong (event) {
        this.setState({loading: true});
        if (event.target.files.length < 1) return;
        const file = event.target.files[0];
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            this.audioContext.decodeAudioData(
                reader.result,
                audio => {
                    const audioData = audio.getChannelData(0);
                    const {audioPeaks, highest} = App.constructPeaks(audioData);
                    this.setState({
                        loading: false
                    });
                    this.scrollStart = 0;
                    this.scrollEnd = audio.duration;

                    // set currentTime to first audibleish sample
                    this.currentTime = 0;
                    for (let i = 0; i < audioData.length; i++) {
                        if (Math.abs(audioData[i]) > 2e-3) {
                            this.currentTime = i / audio.sampleRate;
                            break;
                        }
                    }
                    this.audioBuffer = audio;
                    this.audioData = audioData.slice(0);
                    this.audioPeaks = audioPeaks;
                    this.highestSample = highest;
                },
                error => {
                    this.setState({
                        error: error.message,
                        loading: false
                    });
                }
            )
        });

        reader.addEventListener('error', () => {
            this.setState({error:
                reader.error.message,
                loading: false
            });
        })

        reader.readAsArrayBuffer(file);
    }

    setBPM (event) {
        const bpm = parseInt(event.target.value);
        if (Number.isFinite(bpm)) {
            this.setState({bpm});
        }
    }

    setFirstBeatOffset (event) {
        const firstBeatOffset = parseFloat(event.target.value);
        if (Number.isFinite(firstBeatOffset)) {
            this.setState({firstBeatOffset});
        }
    }

    setFirstBeatOffsetToCursor () {
        this.setState({firstBeatOffset: this.currentTime});
    }

    setQuantize (quantize) {
        this.setState({quantize});
    }

    setVolume (event) {
        this.setState({volume: event.target.value});
    }

    setInputMode (inputMode) {
        this.setState({
            inputMode,
            calibrationMeasurements: inputMode === 'calibration' ? [] : null,
            bpmMeasurements: inputMode === 'bpm' ? [] : null,
        });
    }

    setLatency (event) {
        const latency = parseFloat(event.target.value);
        if (Number.isFinite(latency)) {
            this.setState({latency});
        }
    }

    setCanvas (elem) {
        this.canvas = elem;
        this.ctx = elem.getContext('2d');
    }

    setCanvasContainer (elem) {
        this.canvasContainer = elem;
    }

    componentDidMount () {
        this.requestId = window.requestAnimationFrame(this.update);
        document.body.addEventListener('keydown', this.onCanvasKeyDown);
    }

    componentDidUpdate (prevProps, prevState) {
        if (prevState.volume !== this.state.volume) {
            this.gainNode.gain.value = this.state.volume;
        }
    }

    onCanvasScroll (event) {
        if (event.ctrlKey) {
            const relPos = this.canvasMousePosition[0] / this.canvas.width;

            const zoomAmount = event.deltaY < 0 ? 2 : 0.5;
            const oldWidth = this.scrollEnd - this.scrollStart;
            const newWidth = oldWidth / zoomAmount;
            const widthDiff = oldWidth - newWidth;

            this.scrollStart = Math.max(0, this.scrollStart + (widthDiff * relPos));
            this.scrollEnd = Math.min(this.audioBuffer ? this.audioBuffer.duration : 1, this.scrollEnd - (widthDiff * (1 - relPos)));
        } else {
            const {scrollEnd, scrollStart} = this;
            const diff = scrollEnd - scrollStart;
            const scrollAmount = (event.deltaY > 0 ? 0.01 : -0.01) * diff;
            if (scrollAmount > 0) {
                this.scrollEnd = Math.min(this.audioBuffer ? this.audioBuffer.duration : 1, this.scrollEnd + scrollAmount);
                this.scrollStart = this.scrollEnd - diff;
            } else {
                this.scrollStart = Math.max(0, this.scrollStart + scrollAmount);
                this.scrollEnd = this.scrollStart + diff;
            }
        }

        event.preventDefault();
    }

    onCanvasKeyDown (event) {
        let preventDefault = true;

        switch (event.key) {
            case ' ': {
                if (this.playing) {
                    this.stop();
                } else {
                    this.play();
                }
                break;
            }

            case 'z':
            case 'x':
            case 'c':
            case 'v': {
                switch (this.state.inputMode) {
                    case 'input': {
                        this.createBeat(event.key);
                        break;
                    }
                    case 'calibration': {
                        const time = this.getCurrentTime(false);
                        const beat = this.quantizeTimeToBeat(time);
                        const quantTime =  beat / (this.state.bpm / 60) + this.state.firstBeatOffset;
                        // we don't care about properly updating calibrationMeasurements since we don't use it to render
                        this.state.calibrationMeasurements.push(time - quantTime);
                        this.setState({latency: (this.state.calibrationMeasurements.reduce((prev, cur) => prev + cur, 0) / this.state.calibrationMeasurements.length) * 1000});
                        break;
                    }
                    case 'bpm': {
                        // we don't care about properly updating bpmMeasurements since we don't use it to render
                        const {bpmMeasurements} = this.state;
                        bpmMeasurements.push(this.getCurrentTime());
                        if (bpmMeasurements.length > 1) {
                            let sum = 0;
                            for (let i = 1; i < bpmMeasurements.length; i++) {
                                sum += bpmMeasurements[i] - bpmMeasurements[i - 1];
                            }
                            sum /= (bpmMeasurements.length - 1);

                            this.setState({bpm: parseFloat((60 / sum).toFixed(2))});
                        }
                        break;
                    }
                }
                break;
            }

            default: {
                preventDefault = false;
                break;
            }
        }

        this.keysPressed.add(event.key);

        if (preventDefault) event.preventDefault();
    }

    startDrag (item) {
        this.dragStarted = false;
        this.dragging = true;
        this.draggedItem = item;
    }

    endDrag (cb) {
        if (cb) cb();
        this.dragEnded = false;
        this.draggedItem = null;
    }

    onCanvasMouseMove (event) {
        const {left, top, width, height} = this.canvas.getBoundingClientRect();

        if (this.mouseButtons[0] && !(this.dragStarted || this.dragging)) {
            this.dragStarted = true;
            this.dragStart[0] = this.canvasMousePosition[0];
            this.dragStart[1] = this.canvasMousePosition[1];
        }

        const x = (event.clientX - left) * (this.canvas.width / width);
        const y = (event.clientY - top) * (this.canvas.height / height);
        this.canvasMousePosition[0] = x;
        this.canvasMousePosition[1] = y;
    }

    onCanvasMouseDown (event) {
        for (let i = 0; i < 5; i++) {
            if ((event.buttons & (1 << i)) !== 0) {
                this.mouseButtons[i] = true;
                this.mouseClicked[i] = true;
            }
        }
        event.preventDefault();
    }

    onCanvasMouseUp (event) {
        for (let i = 0; i < 5; i++) {
            // if buttons === 0, release all buttons
            if ((event.buttons & (1 << i)) !== 0 || event.buttons === 0) {
                this.mouseButtons[i] = false;
            }
        }
        if (this.dragging) {
            this.dragEnded = true;
            this.dragging = false;
        }
        event.preventDefault();
    }

    getCurrentTime (latencyCompensate = true) {
        if (!this.playing) return this.currentTime;
        return this.currentTime + (this.audioContext.currentTime - this.playbackStartTime) - (latencyCompensate ? this.state.latency / 1000 : 0);
    }

    quantizeBeat (beat, quantize = this.state.quantize) {
        return quantize === 0 ? beat : Math.round(beat * this.state.quantize) / quantize;
    }

    quantizeTimeToBeat (time, quantize = this.state.quantize) {
        const beat = (time - this.state.firstBeatOffset) * (this.state.bpm / 60);
        return this.quantizeBeat(beat);
    }

    createBeat (key) {
        const beat = this.quantizeTimeToBeat(this.getCurrentTime());
        const beatID = id();
        this.chart[beatID] = {beat, key, id: beatID};
    }

    drawWaveform (ctx, width, height) {
        ctx.fillStyle = '#eee';
        ctx.strokeStyle = '#ddd';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeRect(0, 0, width, height);
        if (!this.audioData) return;
        let startSample = (this.scrollStart * this.audioBuffer.sampleRate) / PEAK_RES;
        let endSample = (this.scrollEnd * this.audioBuffer.sampleRate) / PEAK_RES;
        let samplesInWindow = endSample - startSample;
        let buf = this.audioPeaks;
        if (samplesInWindow / width < 1) {
            startSample = this.scrollStart * this.audioBuffer.sampleRate;
            endSample = this.scrollEnd * this.audioBuffer.sampleRate;
            samplesInWindow = endSample - startSample;
            buf = this.audioData;
        }
        ctx.fillStyle = 'black';
        for (let i = 0; i < width; i++) {
            const startColSample = Math.round(((i * samplesInWindow) / width) + startSample);
            const endColSample = Math.max(Math.round((((i + 1) * samplesInWindow) / width) + startSample), startColSample + 1);

            let max = 0;
            for (let j = startColSample; j < endColSample; j++) {
                max = Math.abs(buf[j]) > max ? Math.abs(buf[j]) : max;
            }

            const heightMul = height / this.highestSample;
            const rectHeight = Math.max(1, max * heightMul);

            ctx.fillRect(i, (height / 2) - (rectHeight / 2), 1, rectHeight);
        }
    }

    drawChart (ctx, width, height) {
        const beatsPerSecond = this.state.bpm / 60;
        const firstBeat = this.state.firstBeatOffset - this.scrollStart;
        const windowDuration = this.scrollEnd - this.scrollStart;
        const numBeats = windowDuration * beatsPerSecond;
        const scale = width / numBeats;
        const offset = (((firstBeat * (width / windowDuration)) % scale) + scale) % scale;

        const subdivs = [];
        let i = 1;
        while (i <= (this.state.quantize || 4)) {
            subdivs.push(i);
            i *= 2;
        }

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'black';
        for (const subdiv of subdivs) {
            ctx.globalAlpha = 1 / subdiv;
            ctx.beginPath();
            for (let i = 0; i < (numBeats + 1) * subdiv; i++) {
                ctx.moveTo(((i / subdiv) - 1) * scale + offset, 0);
                ctx.lineTo(((i / subdiv) - 1) * scale + offset, height);
            }
            ctx.stroke();
        }

        const secsToPixels = s => (s - this.scrollStart) * (width / windowDuration);

        ctx.lineWidth = 3;
        ctx.strokeStyle = 'blue';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(secsToPixels(this.state.firstBeatOffset), 0);
        ctx.lineTo(secsToPixels(this.state.firstBeatOffset), height);
        ctx.stroke();
    }

    drawTimeMarker (ctx, width, height, time) {
        const windowDuration = this.scrollEnd - this.scrollStart;
        const secsToPixels = s => (s - this.scrollStart) * (width / windowDuration);

        const ARROW_SIZE = 8;
        const LINE_WIDTH = 1;

        const x = secsToPixels(time);

        ctx.fillStyle = 'red';
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - LINE_WIDTH, ARROW_SIZE - LINE_WIDTH);
        ctx.lineTo(x - ARROW_SIZE, 0);
        ctx.lineTo(x + ARROW_SIZE, 0);
        ctx.lineTo(x + LINE_WIDTH, ARROW_SIZE - LINE_WIDTH);
        ctx.lineTo(x + LINE_WIDTH, height);
        ctx.lineTo(x - LINE_WIDTH, height);
        ctx.fill();
    }

    drawBeats (ctx, width, height) {
        const beatColors = {
            z: 'red',
            x: 'green',
            c: 'blue',
            v: '#ee8800'
        };
        const beatHeights = {
            z: 0,
            x: 1,
            c: 2,
            v: 3
        };

        const windowDuration = this.scrollEnd - this.scrollStart;
        const numBeats = windowDuration * (this.state.bpm / 60);
        const beatWidth = width / numBeats;
        const bHeight = height / BUTTONS.length;
        const fontSize = Math.min(Math.max(8, beatWidth / (this.state.quantize || 1)), bHeight * 0.75);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';

        const charWidth = BUTTONS.reduce((prev, key) => Math.max(ctx.measureText(key).width, prev), 0);

        const beatsToSecs = beat => beat / (this.state.bpm / 60) + this.state.firstBeatOffset;
        const beatsToPixels = beat => (beatsToSecs(beat) - this.scrollStart) * (width / windowDuration);

        const secsToBeats = secs => secs * (this.state.bpm / 60);
        const pixelsToBeats = pixels => secsToBeats((pixels / (width / windowDuration)));

        const LINE_WIDTH = 1;
        const TRIANGLE_SIZE = 4;
        const TEXT_PADDING = Math.max(1, Math.min(fontSize / 8, 4));

        const drawBeat = (x, y, color, alpha, character, ghost = false) => {
            ctx.globalAlpha = alpha;
            const bottom = y + bHeight;

            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = LINE_WIDTH * 2;
            if (ghost) {
                ctx.strokeRect(x - LINE_WIDTH, y + LINE_WIDTH, charWidth + (LINE_WIDTH * 2) + (TEXT_PADDING * 2), bHeight - (LINE_WIDTH * 2));
            } else {
                ctx.fillRect(x, y, charWidth + LINE_WIDTH + (TEXT_PADDING * 2), bHeight);
            }

            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(LINE_WIDTH + x, y);
            ctx.lineTo(-LINE_WIDTH - TRIANGLE_SIZE + x, y);
            ctx.lineTo(-LINE_WIDTH + x, y + TRIANGLE_SIZE);
            ctx.lineTo(-LINE_WIDTH + x, bottom);
            ctx.lineTo(LINE_WIDTH + x, bottom);
            ctx.fill();

            ctx.fillStyle = ghost ? color : 'black';
            ctx.fillText(character, x + LINE_WIDTH + TEXT_PADDING, y + (bHeight / 2));
        }

        const beatAndRowFromMouse = beat => {
            const [mx, my] = this.canvasToLocal(...this.canvasMousePosition);
            const [dx, dy] = this.canvasToLocal(...this.dragStart);
            const newBeat = this.quantizeBeat(pixelsToBeats(mx - dx) + beat.beat);
            const newRow = Math.round(((my - dy) / bHeight) + beatHeights[beat.key]);
            return [newBeat, newRow];
        }

        for (const i in this.chart) {
            if (!Object.prototype.hasOwnProperty.call(this.chart, i)) continue;
            const beat = this.chart[i];

            if (this.dragEnded && this.draggedItem === beat.id) {
                this.endDrag(() => {
                    const [newBeat, newRow] = beatAndRowFromMouse(beat);
                    beat.beat = newBeat;
                    beat.key = BUTTONS[newRow];
                });
            }

            const x = beatsToPixels(beat.beat);
            const y = beatHeights[beat.key] * bHeight;
            ctx.fillStyle = beatColors[beat.key];

            let alpha = 0.325;
            if (this.regionHovered(x, y, charWidth + LINE_WIDTH + (TEXT_PADDING * 2), bHeight)) {
                this.canvas.style.cursor = 'pointer';
                alpha = 0.625;

                if (this.keysPressed.has('Delete')) {
                    delete this.chart[beat.id];
                    continue;
                }

                if (this.dragStarted) {
                    this.startDrag(beat.id);
                }
            }

            if (this.draggedItem === beat.id) {
                ctx.globalAlpha = 0.125;
                const [newBeat, newRow] = beatAndRowFromMouse(beat);

                drawBeat(beatsToPixels(newBeat), newRow * bHeight, beatColors[BUTTONS[newRow]], 0.325, BUTTONS[newRow], true);

                ctx.save();
                const [mx, my] = this.canvasToLocal(...this.canvasMousePosition);
                const [dx, dy] = this.canvasToLocal(...this.dragStart);
                ctx.translate(mx - dx, my - dy);
            }

            drawBeat(x, y, beatColors[beat.key], alpha, beat.key);

            if (this.draggedItem === beat.id) {
                ctx.restore();
            }
        }
    }

    play () {
        this.audioSource = this.audioContext.createBufferSource();
        this.audioSource.buffer = this.audioBuffer;
        this.audioSource.connect(this.gainNode);
        this.audioSource.start(0, this.currentTime);
        this.playbackStartTime = this.audioContext.currentTime;
        this.playing = true;
    }

    stop () {
        if (!this.audioSource) return;
        this.audioSource.stop();
        this.audioSource.disconnect();
        this.audioSource = null;
        this.currentTime = this.getCurrentTime();
        this.playbackStartTime = null;
        this.playing = false;
    }

    canvasToLocal(x, y) {
        const {a, b, c, d, e, f} = this.ctx.getTransform().invertSelf();
        return [
            a * x + c * y + e,
            b * x + d * y + f
        ];
    }

    localToCanvas(x, y) {
        const {a, b, c, d, e, f} = this.ctx.getTransform();
        return [
            a * x + c * y + e,
            b * x + d * y + f
        ];
    }

    regionHovered (x, y, width, height) {
        const [mouseX, mouseY] = this.canvasToLocal(this.canvasMousePosition[0], this.canvasMousePosition[1]);
        return mouseX >= x &&
        mouseX < x + width &&
        mouseY >= y &&
        mouseY < y + height;
    }

    regionClicked (x, y, width, height, button = 0) {
        return this.mouseClicked[button] && this.regionHovered(x, y, width, height);
    }

    update () {
        const {ctx} = this;

        const {width: rectWidth, height: rectHeight} = this.canvas.getBoundingClientRect();
        const width = Math.round(rectWidth * devicePixelRatio);
        const height = Math.round(rectHeight * devicePixelRatio);

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        this.canvas.style.cursor = null;

        ctx.clearRect(0, 0, width, height);

        ctx.save();
        this.drawWaveform(ctx, width, height / 2);
        ctx.restore();

        ctx.save();
        ctx.scale(devicePixelRatio, devicePixelRatio);

        ctx.save();
        ctx.translate(0, rectHeight / 2);
        this.drawChart(ctx, rectWidth, rectHeight / 2);
        ctx.restore();

        const markerTime = this.playbackStartTime === null ? this.currentTime : this.getCurrentTime();
        ctx.save();
        this.drawTimeMarker(ctx, rectWidth, rectHeight, markerTime);
        ctx.restore();


        if (this.regionHovered(0, 0, rectWidth, rectHeight / 2)) {
            const hoveredTime = (this.canvasMousePosition[0] / width) * (this.scrollEnd - this.scrollStart) + this.scrollStart;
            ctx.globalAlpha = 0.25;
            ctx.save();
            this.drawTimeMarker(ctx, rectWidth, rectHeight, hoveredTime);
            ctx.restore();

            if (this.regionClicked(0, 0, rectWidth, rectHeight / 2)) {
                const {playing} = this;
                if (playing) this.stop();
                this.currentTime = hoveredTime;
                if (playing) this.play();
            }
        }

        ctx.save();
        ctx.translate(0, rectHeight / 2);
        this.drawBeats(ctx, rectWidth, rectHeight / 2);
        ctx.restore();

        ctx.restore();

        for (let i = 0; i < this.mouseClicked.length; i++) {
            this.mouseClicked[0] = false;
        }
        this.dragStarted = false;
        this.dragEnded = false;
        this.keysPressed.clear();

        this.requestId = window.requestAnimationFrame(this.update);
    }

    componentWillUnmount () {
        if (this.requestId !== null) {
            window.cancelAnimationFrame(this.requestId);
        }

        document.body.removeEventListener('keydown', this.onCanvasKeyDown);
    }

    render () {
        return html`
            <div class="app">
                ${this.state.error ? html`
                    <div class="error">${this.state.error}</div>
                ` : null}
                <div class="settings">
                    <div className="song">
                        <span class="setting-label">Song: </span>
                        <input type="file" onChange=${this.setSong} disabled=${this.state.loading} />
                    </div>
                    <div className="bpm">
                        <span class="setting-label">BPM: </span>
                        <input type="number" value=${this.state.bpm} onChange=${this.setBPM} />
                    </div>
                    <div className="first-beat">
                        <span class="setting-label">First beat offset: </span>
                        <input type="number" value=${this.state.firstBeatOffset} onChange=${this.setFirstBeatOffset} />
                        <span class="setting-label"> sec </span>
                        <button onClick=${this.setFirstBeatOffsetToCursor}>To cursor</button>
                    </div>
                    <div className="quantize">
                        <span class="setting-label">Quantize: </span>
                        <${ButtonGroup}
                            options=${[0, 1, 2, 4, 8, 16, 32].map(n => ({id: n, value: n == 0 ? 'None' : `1/${n}`}))}
                            selected=${this.state.quantize}
                            onChange=${this.setQuantize}/>
                    </div>
                    <div className="volume">
                        <span class="setting-label">Volume: </span>
                        <input type="range" min="0" max="1" step="any" value=${this.state.volume} onInput=${this.setVolume} />
                    </div>
                </div>
                <div class="settings">
                    <div className="calibration-mode">
                        <span class="setting-label">Input mode: </span>
                        <${ButtonGroup}
                            options=${[
                                {id: 'input', value: 'Input notes'},
                                {id: 'bpm', value: 'Tap for BPM'},
                                {id: 'calibration', value: 'Calibrate latency'},
                            ]}
                            selected=${this.state.inputMode}
                            onChange=${this.setInputMode}/>
                    </div>
                    <div className="latency">
                        <span class="setting-label">Latency (ms): </span>
                        <input type="number" value=${this.state.latency} onChange=${this.setLatency} />
                    </div>
                </div>
                <div class="chart-container" ref=${this.setCanvasContainer}>
                    <canvas
                        class="chart-canvas"
                        ref=${this.setCanvas}
                        onWheel=${this.onCanvasScroll}
                        onMouseMove=${this.onCanvasMouseMove}
                        onMouseDown=${this.onCanvasMouseDown}
                        onMouseUp=${this.onCanvasMouseUp}
                    />
                </div>
            </div>
        `;
    }
}

render(html`<${App} />`, document.getElementById("app-container"));