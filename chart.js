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
            calibrationMode: false,
            calibrationMeasurements: null,
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

        this.mouseButton = -1;
        this.keysPressed = new Set();

        this.chart = [];

        this.setSong = this.setSong.bind(this);
        this.setBPM = this.setBPM.bind(this);
        this.setFirstBeatOffset = this.setFirstBeatOffset.bind(this);
        this.setQuantize = this.setQuantize.bind(this);
        this.setVolume = this.setVolume.bind(this);
        this.setCalibrationMode = this.setCalibrationMode.bind(this);
        this.setLatency = this.setLatency.bind(this);
        this.setCanvas = this.setCanvas.bind(this);
        this.setCanvasContainer = this.setCanvasContainer.bind(this);
        this.update = this.update.bind(this);

        this.onCanvasScroll = this.onCanvasScroll.bind(this);
        this.onCanvasMouseMove = this.onCanvasMouseMove.bind(this);
        this.onCanvasKeyDown = this.onCanvasKeyDown.bind(this);
        this.onCanvasMouseClick = this.onCanvasMouseClick.bind(this);
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
                    this.currentTime = 1;
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

    setQuantize (quantize) {
        this.setState({quantize});
    }

    setVolume (event) {
        this.gainNode.gain.value = event.target.value;
    }

    setCalibrationMode (event) {
        this.setState({
            calibrationMode: event.target.checked,
            calibrationMeasurements: event.target.checked ? [] : null
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

    onCanvasMouseMove (event) {
        const {left, top, width, height} = this.canvas.getBoundingClientRect();

        const x = (event.clientX - left) * (this.canvas.width / width);
        const y = (event.clientY - top) * (this.canvas.height / height);
        this.canvasMousePosition[0] = x;
        this.canvasMousePosition[1] = y;
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
                if (this.state.calibrationMode) {
                    const time = this.getCurrentTime(false);
                    const beat = this.quantizeTimeToBeat(time);
                    const quantTime =  beat / (this.state.bpm / 60) + this.state.firstBeatOffset;
                    // we don't care about properly updating calibrationMeasurements since we don't use it to render
                    this.state.calibrationMeasurements.push(time - quantTime);
                    this.setState({latency: (this.state.calibrationMeasurements.reduce((prev, cur) => prev + cur, 0) / this.state.calibrationMeasurements.length) * 1000});
                } else {
                    this.createBeat(event.key);
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

    onCanvasMouseClick (event) {
        this.mouseButton = event.button;
        event.preventDefault();
    }

    getCurrentTime (latencyCompensate = true) {
        if (!this.playing) return this.currentTime;
        return this.currentTime + (this.audioContext.currentTime - this.playbackStartTime) - (latencyCompensate ? this.state.latency / 1000 : 0);
    }

    quantizeTimeToBeat (time, quantize = this.state.quantize) {
        const beat = (time - this.state.firstBeatOffset) * (this.state.bpm / 60);
        const quantized = quantize === 0 ? beat : Math.round(beat * this.state.quantize) / quantize;
        return quantized;
    }

    createBeat (key) {
        const beat = this.quantizeTimeToBeat(this.getCurrentTime());
        this.chart.push({
            beat,
            key
        });
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
            v: 'yellow'
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
        const LINE_WIDTH = 1;
        const TRIANGLE_SIZE = 4;
        const TEXT_PADDING = Math.max(1, Math.min(fontSize / 8, 4));

        for (let i = 0; i < this.chart.length; i++) {
            const beat = this.chart[i];
            const x = beatsToPixels(beat.beat);
            const top = beatHeights[beat.key] * bHeight;
            const bottom = top + bHeight;
            ctx.fillStyle = beatColors[beat.key];

            if (this.regionHovered(x, top, charWidth + LINE_WIDTH + (TEXT_PADDING * 2), bHeight)) {
                this.canvas.style.cursor = 'pointer';
                ctx.globalAlpha = 0.625;

                if (this.keysPressed.has('Delete')) {
                    this.chart.splice(i, 1);
                    i--;
                }
            } else {
                ctx.globalAlpha = 0.325;
            }
            ctx.fillRect(x, top, charWidth + LINE_WIDTH + (TEXT_PADDING * 2), bHeight);

            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(LINE_WIDTH + x, top);
            ctx.lineTo(-LINE_WIDTH - TRIANGLE_SIZE + x, top);
            ctx.lineTo(-LINE_WIDTH + x, top + TRIANGLE_SIZE);
            ctx.lineTo(-LINE_WIDTH + x, bottom);
            ctx.lineTo(LINE_WIDTH + x, bottom);
            ctx.fill();

            ctx.fillStyle = 'black';
            ctx.fillText(beat.key, x + LINE_WIDTH + TEXT_PADDING, top + (bHeight / 2));
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

    regionHovered (x, y, width, height) {
        const {a, b, c, d, e, f} = this.ctx.getTransform().invertSelf();
        const mouseX = a * this.canvasMousePosition[0] + c * this.canvasMousePosition[1] + e;
        const mouseY = b * this.canvasMousePosition[0] + d * this.canvasMousePosition[1] + f;
        return mouseX >= x &&
        mouseX < x + width &&
        mouseY >= y &&
        mouseY < y + height;
    }

    regionClicked (x, y, width, height) {
        return this.mouseButton > -1 && this.regionHovered(x, y, width, height);
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

        this.requestId = window.requestAnimationFrame(this.update);
        this.mouseButton = -1;
        this.keysPressed.clear();
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
                        <span class="setting-label"> sec</span>
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
                        <span class="setting-label">Calibration mode: </span>
                        <input type="checkbox" onChange=${this.setCalibrationMode} checked=${this.state.calibrationMode} />
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
                        onClick=${this.onCanvasMouseClick}
                    />
                </div>
            </div>
        `;
    }
}

render(html`<${App} />`, document.getElementById("app-container"));