import * as THREE from 'three'
import { Texture } from 'three';
import { GUI } from 'three/examples/jsm/libs/dat.gui.module'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import uvgrid from './uvgrid.png'

/*
This class cretes THREE.js shader meshes that have responsive uniforms to bci and shadertoy presets

Usage:

let helper = new THREEShaderHelper(session,canvas);

three.scene.add(this.meshes[0]);

//you can add meshes, uniforms, and a bunch of other things

//in animation loop:
    this.updateAllMaterialUniforms();
    three.renderer.render(three.scene, three.camera);
*/

import { SoundJS } from './util/Sound'

export class THREEShaderHelper {

static defaultVertex = `
varying vec2 vUv;

void main()
{

    vUv = uv;

    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;
}
`;

static defaultFragment = `
#define FFTLENGTH 256
precision mediump float;
uniform vec2 iResolution; //Shader display resolution
uniform float iTime; //Shader time increment

uniform float iHEG;
uniform float iHRV;
uniform float iHR;
uniform float iHB;
uniform float iFrontalAlpha1Coherence;
uniform float iFFT[FFTLENGTH];
uniform float iAudio[FFTLENGTH];
void main(){
    gl_FragColor = vec4(iAudio[20]/255. + iHEG*0.1+gl_FragCoord.x/gl_FragCoord.y,gl_FragCoord.y/gl_FragCoord.x,gl_FragCoord.y/gl_FragCoord.x - iHEG*0.1 - iAudio[120]/255.,1.0);
}                    
`;

    constructor(canvas=undefined,sounds=undefined) {

        if(!canvas) {console.error('THREEShaderHelper needs a canvas!'); return false;};

        this.audio = sounds; //audio context
        if(!sounds) {
            if(AudioContext) {
                this.audio = new SoundJS();
            }
        }
        this.eegchannel = 0;
        this.heg = 0;

        this.canvas = canvas;
        this.startTime=Date.now();
        this.lastTime = this.startTime;
        this.lastFrame = this.startTime;
        this.mouseclicked = 0.0;
        this.mousexyzw = [0,0,0,0];

        this.addCanvasEventListeners(canvas);

        let date = new Date();

        this.uniforms = {
            iResolution: {value:THREE.Vector2(100,100)}, //viewport resolution
            iTime:      {value:0}, //milliseconds elapsed from shader begin
            iTimeDelta: {value:0},
            iFrame:     {value:0},
            iFrameRate: {value:0},
            iChannelTime:   {value:[0,0,0,0]},
            iChannelResolution:{type:'v3v', value:[new THREE.Vector3(100,100),new THREE.Vector3(100,100),new THREE.Vector3(100,100),new THREE.Vector3(100,100)]},
            iChannel0:  {type:'t', value:new THREE.Texture(uvgrid)},
            iChannel1:  {type:'t', value:new THREE.Texture(uvgrid)},
            iChannel2:  {type:'t', value:new THREE.Texture(uvgrid)},
            iChannel3:  {type:'t', value:new THREE.Texture(uvgrid)},
            iSampleRate:    {type:'1f', value:44100},
            iDate:      {value:new THREE.Vector4(date.getYear(),date.getMonth(),date.getDay(),date.getHours()*3600+date.getMinutes()*60+date.getSeconds())},
            iMouse:     {value:[0,0,0,0]},  //XY mouse coordinates, z, w are last click location
            iMouseInput: {value:false}, //Click occurred before past frame?
            iImage:     {type:'t', value:new THREE.Texture(canvas)}, //Texture map returned from shader (to keep state)
            iAudio:           {value:new Array(2048).fill(0)},     //Audio analyser FFT, array of 256, values max at 255
            iHRV:             {value:0},       //Heart Rate Variability (values typically 5-30)
            iHEG:             {value:0},       //HEG change from baseline, starts at zero and can go positive or negative
            iHR:              {value:0},       //Heart Rate in BPM
            iHB:              {value:0},       //Is 1 when a heart beat occurs, falls off toward zero on a 1/t curve (s)
            iBRV:             {value:0},       //Breathing rate variability, usually low, ideal is 0.
            iFFT:             {value:new Array(256).fill(0)},  //Raw EEG FFT, array of 256. Values *should* typically be between 0 and 100 (for microvolts) but this can vary a lot so normalize or clamp values as you use them
            iDelta:           {value:0},       //Delta bandpower average. The following bandpowers have generally decreasing amplitudes with frequency.
            iTheta:           {value:0},       //Theta bandpower average.
            iAlpha1:          {value:0},       //Alpha1 " "
            iAlpha2:          {value:0},       //Alpha2 " "
            iBeta:            {value:0},       //Beta " "
            iGamma:           {value:0},       //Low Gamma (30-45Hz) " "
            iThetaBeta:       {value:0},       //Theta/Beta ratio
            iAlpha1Alpha2:    {value:0},       //Alpha1/Alpha2 ratio
            iAlphaBeta:       {value:0},       //Alpha/Beta ratio
            i40Hz:            {value:0},       //40Hz bandpower
            iFrontalAlpha1Coherence: {value:0} //Alpha 1 coherence, typically between 0 and 1 and up, 0.9 and up is a strong correlation
        }

        //default settings for uniforms
        this.uniformSettings = {
            iResolution: {default:THREE.Vector2(100,100),min:8,max:8192, step:1}, //viewport resolution
            iTime:      {default:0,min:0,max:999999, step:1}, //milliseconds elapsed from shader begin
            iTimeDelta: {default:0,min:0,max:2, step:0.1},
            iFrame:     {default:0,min:0,max:999999, step:1},
            iFrameRate: {default:0,min:0,max:144, step:1},
            iChannelTime:   {default:[0,0,0,0],min:0,max:99999, step:1},
            iChannelResolution:{type:'v3v',min:8,max:8192, step:1, default:[new THREE.Vector3(100,100),new THREE.Vector3(100,100),new THREE.Vector3(100,100),new THREE.Vector3(100,100)]},
            iChannel0:  {type:'t', default:new THREE.Texture(uvgrid)},
            iChannel1:  {type:'t', default:new THREE.Texture(uvgrid)},
            iChannel2:        {type:'t', default:new THREE.Texture(uvgrid)},
            iChannel3:        {type:'t', default:new THREE.Texture(uvgrid)},
            iSampleRate:      {type:'1f', default:44100,min:8000,max:96000, step:1000},
            iDate:            {default:new THREE.Vector4(date.getYear(),date.getMonth(),date.getDay(),date.getHours()*3600+date.getMinutes()*60+date.getSeconds())},
            iMouse:           {default:[0,0,0,0],min:0,max:8192, step:1},  //XY mouse coordinates, z, w are last click location
            iMouseInput:      {default:false}, //Click occurred before past frame?
            iImage:           {type:'t', default:new THREE.Texture(canvas)}, //Texture map returned from shader (to keep state)
            iAudio:           {default: new Array(2048).fill(0), min:0,max:255, step:1},              //Audio analyser FFT, array of 256, values max at 255
            iHRV:             {default:0, min:0, max:40,step:0.5},                           //Heart Rate Variability (values typically 5-30)
            iHEG:             {default:0, min:-3, max:3,step:0.1},                           //HEG change from baseline, starts at zero and can go positive or negative
            iHR:              {default:0, min:0, max:240,step:1},                            //Heart Rate in BPM
            iHB:              {default:0, min:0, max:1},                                     //Is 1 when a heart beat occurs, falls off toward zero on a 1/t curve (s)
            iBRV:             {default:0, min:0, max:10,step:0.5},                           //Breathing rate variability, usually low, ideal is 0.
            iFFT:             {default:new Array(256).fill(0),min:0,max:1000},               //Raw EEG FFT, array of 256. Values *should* typically be between 0 and 100 (for microvolts) but this can vary a lot so normalize or clamp values as you use them
            iDelta:           {default:0, min:0, max:100,step:0.5},                          //Delta bandpower average. The following bandpowers have generally decreasing amplitudes with frequency.
            iTheta:           {default:0, min:0, max:100,step:0.5},                          //Theta bandpower average.
            iAlpha1:          {default:0, min:0, max:100,step:0.5},                          //Alpha1 " "
            iAlpha2:          {default:0, min:0, max:100,step:0.5},                          //Alpha2 " "
            iBeta:            {default:0, min:0, max:100,step:0.5},                          //Beta " "
            iGamma:           {default:0, min:0, max:100,step:0.5},                          //Low Gamma (30-45Hz) " "
            iThetaBeta:       {default:0, min:0, max:5,step:0.1},                            //Theta/Beta ratio
            iAlpha1Alpha2:    {default:0, min:0, max:5,step:0.1},                            //Alpha1/Alpha2 ratio
            iAlphaBeta:       {default:0, min:0, max:5,step:0.1},                            //Alpha/Beta ratio
            iAlphaTheta:      {default:0, min:0, max:5,step:0.1},
            i40Hz:            {default:0, min:0, max:10,step:0.1},                           //40Hz bandpower
            iFrontalAlpha1Coherence: {default:0, min:0, max:1.1,step:0.1}                           //Alpha 1 coherence, typically between 0 and 1 and up, 0.9 and up is a strong correlation
        }

        this.vertex = this.defaultVertex;
        this.fragment = this.defaultFragment;

        this.shaderSettings = [{
            name: 'default',
            vertexShader: this.vertex,
            fragmentShader: this.fragment,
            uniformNames:[
                'iResolution',
                'iTime',
                'iHEG',
                'iHRV',
                'iHR',
                'iHB',
                'iFrontalAlpha1Coherence',
                'iFFT',
                'iAudio'
            ],
            author:'B@P'
        }];

        this.three = {};

        let uniforms = this.generateMaterialUniforms();

        let geometry = this.createMeshGeometry('plane',canvas.width,canvas.height);
        this.currentViews = ['plane'];

        let material = new THREE.ShaderMaterial({
            transparent:true,
            side: THREE.DoubleSide,
            vertexShader: this.shaderSettings[0].vertexShader,
            fragmentShader: this.shaderSettings[0].fragmentShader,
            uniforms:uniforms
        });

        let mesh = new THREE.Mesh({
            geometry:geometry,
            material:material,
        });

        //default uniform and mesh
        this.materials = [material];
        this.meshes = [mesh];

        this.setMeshRotation(0);

    }

    //Generate a shader mesh with the specified parameters. Returns a mesh with the ShaderMaterial applied.
    static generateShaderGeometry(type='plane',width,height,fragment=this.defaultFragment,vertex=this.defaultVertex) {
        let geometry = this.createMeshGeometry(type,width,height);
        let material = this.generateShaderMaterial(fragment,vertex);
        return new THREE.Mesh(geometry,material);
    }
    
    //Generate a shader material with the specified vertex and fragment. Returns a material.
    static generateShaderMaterial(fragment=this.defaultFragment,vertex=this.defaultVertex) {
        return new THREE.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            side: THREE.DoubleSide,
            transparent: true
        });
    }

    //Generate a shader mesh with the specified parameters: supports sphere, plane, circle, halfsphere, vrscreen
    static createMeshGeometry(type='plane',width,height){
        if (type === 'sphere'){
            return new THREE.SphereGeometry(Math.min(width, height), 50, 50).rotateY(-Math.PI*0.5);
        } else if (type === 'plane') {
            let plane = new THREE.PlaneGeometry(width, height, 1, 1);
            let angle = (2 * Math.PI * 1) - Math.PI/2;
            plane.position.set(radius*(Math.cos(angle)),0,radius*(Math.sin(angle)));
            plane.rotation.set(0,-angle - Math.PI/2,0);
            return plane;
        } else if (type === 'circle') {      
            return new THREE.CircleGeometry( Math.min(width, height), 32 );
        } else if (type === 'halfsphere') {      
            return new THREE.SphereGeometry(Math.min(width, height), 50, 50, -2*Math.PI, Math.PI, 0, Math.PI).translate(0,0,-3);
        } else if (type === 'vrscreen') {
            return new THREE.SphereGeometry(Math.min(width, height), 50, 50, -2*Math.PI-1, Math.PI+1, 0.5, Math.PI-1).rotateY(0.5).translate(0,0,-3);
        }
    }

    //averages values when downsampling.
    static downsample(array, fitCount, scalar=1) {

        if(array.length > fitCount) {        
            let output = new Array(fitCount);
            let incr = array.length/fitCount;
            let lastIdx = array.length-1;
            let last = 0;
            let counter = 0;
            for(let i = incr; i < array.length; i+=incr) {
                let rounded = Math.round(i);
                if(rounded > lastIdx) rounded = lastIdx;
                for(let j = last; j < rounded; j++) {
                    output[counter] += array[j];
                }
                output[counter] /= (rounded-last)*scalar;
                counter++;
                last = rounded;
            }
            return output;
        } else return array; //can't downsample a smaller array
    }

    static upsample(data, fitCount, scalar=1) {

		var linearInterpolate = function (before, after, atPoint) {
			return (before + (after - before) * atPoint)*scalar;
		};

		var newData = new Array();
		var springFactor = new Number((data.length - 1) / (fitCount - 1));
		newData[0] = data[0]; // for new allocation
		for ( var i = 1; i < fitCount - 1; i++) {
			var tmp = i * springFactor;
			var before = new Number(Math.floor(tmp)).toFixed();
			var after = new Number(Math.ceil(tmp)).toFixed();
			var atPoint = tmp - before;
			newData[i] = linearInterpolate(data[before], data[after], atPoint);
		}
		newData[fitCount - 1] = data[data.length - 1]; // for new allocation
		return newData;
	}

    deinit() {
        this.removeCanvasEventListeners();
    }

    onmousemove=(ev)=> {
        this.mousexyzw[0] = ev.offsetX;
        this.mousexyzw[1] = ev.offsetY;
    }

    mousedown = (ev) => {
        this.mouseclicked = 1.0;
        this.mousexyzw[2] = ev.offsetX;
        this.mousexyzw[3] = ev.offsetY; 
    }

    addCanvasEventListeners(canvas=this.canvas) { 
        canvas.addEventListener('mousemove', this.onmousemove);
        canvas.addEventListener('mousedown', this.mousedown);
    }

    removeCanvasEventListeners(canvas=this.canvas) { 
        canvas.removeEventListener('mousemove', this.onmousemove);
        canvas.removeEventListener('mousedown', this.mousedown);
    }

    
    //lets you add uniform settings e.g. textures, floats, vertex lists (for meshes, type=v3v)
    addUniformSetting(name='newUniform',defaultValue=0,type=undefined,callback=()=>{return 0;},min=0,max=1,step=0.1) { //min,max,step are for slider controls (only applies to floats)
        this.uniformSettings[name] = {default:defaultValue,min:min,max:max,step:step,callback:callback};
        this.uniforms[name] = {value:defaultValue};
        if(type) { this.uniforms[name].type = type; }
    }

    //create a whole new shader mesh with specified settings
    addNewShaderMesh(
        fragment=this.defaultFragment,
        vertex=this.defaultVertex,
        type='plane',
        width=this.canvas.width, 
        height=this.canvas.height,
        uniformNames=[],
        name='',
        author=''
    ) {
        let geometry;
        if(typeof type === 'string') geometry = this.createMeshGeometry(type,width,height);
        else geometry = type; //can pass a str8 geometry object
        let material = this.generateShaderMaterial(fragment,vertex);
        let mesh = new THREE.Mesh(geometry,material);
        

        this.shaderSettings.push({
            name:name,
            vertexShader: vertex,
            fragmentShader: fragment,
            uniformNames:uniformNames,
            author:author
        });

        let uniforms = this.generateMaterialUniforms(this.shaderSettings[this.shaderSettings.length-1]);

        materal.uniforms = uniforms;

        this.updateMaterialUniforms(material,uniformNames,type);

        this.currentViews.push(type);
        this.materials.push(material);
        this.meshes.push(mesh);

    }

    //sets the uniforms to be updated
    setUniforms(uniforms={}) {
        for(const prop in uniforms) {
            if(this.uniforms[prop].value)
                this.uniforms[prop].value = uniforms[prop];
            else this.uniforms[prop].value = {value:uniforms[prop]};
        }
    }

    //only applies to the main mesh geometry
    setMeshGeometry(matidx=0,type='plane') {
        if(this.meshes[matidx]) {
            this.currentViews[matidx] = type;
            this.meshes[matidx].geometry = this.createMeshGeometry(type);
            this.meshes[matidx].rotation.set(0,Math.PI,0);
        }
    }

    setMeshRotation(matidx=0,anglex=0,angley=Math.PI,anglez=0){
        if(this.meshes[matidx])
            this.meshes[matidx].rotation.set(anglex,angley,anglez);
    }

    //this should allow you to set custom textures
    setChannelTexture(channelNum=0,imageOrVideo=uvgrid,material=this.materials[0]) {
        if(!this.uniforms['iChannel'+channelNum]) { //if adding new textures, the glsl needs to be able to accommodate it
            let l = this.uniforms['iChannelResolution'].value.length-1;
            if(this.uniforms['iChannelResolution'].value.length-1 < channelNum) {
                this.uniforms['iChannelResolution'].value.push(...new Array(channelNum-l).fill(0));
                this.uniforms['iChannelTime'].value.push(...new Array(channelNum-l).fill(Date.now()-this.startTime));
            }
        }
        this.uniforms['iChannel'+channelNum] = {type:'t', value:new THREE.Texture(imageOrVideo)};
        this.uniforms['iChannelResolution'].value[channelNum] = new THREE.Vector2(imageOrVideo.width, imageOrVideo.height);
        if(material) {
            material.uniforms['iChannel'+channelNum] = this.uniforms['iChannel'+channelNum];
            material.uniforms['iChannelResolution'] = this.uniforms['iChannelResolution'];
            material.uniforms['iChannelTime'] = this.uniforms['iChannelTime'];
        }
    }

    generateMaterialUniforms(shaderSettings=this.shaderSettings[0]) {
        let uniforms = {};
        shaderSettings.uniformNames.forEach((u)=>{
            let pass = false;
            for(const prop in this.uniforms) {
                if (prop === 'iChannelResolution') {
                    uniforms[u] = this.uniforms[u];
                } else if (prop.includes('iChannel')) {
                    uniforms[u] = this.uniforms[u];
                    if(!uniforms['iChannelResolution']) {
                        uniforms['iChannelResolution'] = this.uniforms['iChannelResolution'];
                    }
                    let ch = parseInt(u[8]);
                    uniforms['iChannelResolution'].value[ch] = new THREE.Vector3(
                        uniforms[u].value.image.width,
                        uniforms[u].value.image.height
                    );
                } else if (prop.includes('iImage')){
                   uniforms[u] = {type:'t',value:new THREE.Texture(canvas)};
                }
                else if(u === prop) {
                    uniforms[u]=this.uniforms[u];
                    pass = true;
                    break;
                }
            }
        });
        return uniforms;
    }

    resetMaterialUniforms(material=this.materials[0],uniformNames=this.shaderSettings[0].uniformNames) {
        for(let name in uniformNames) {
            if(this.uniformSettings[name]) {
                this.uniforms[name].value = this.uniformSettings[name].default;
                material.uniforms[name] = this.uniforms[name];
            }
        }
    }



    //Updates dynamic uniforms for selected material, uniforms. Static uniforms (textures, meshes, etc) are set once.
    updateMaterialUniforms(material=this.materials[0],uniformNames=this.shaderSettings[0].uniformNames,meshType=this.currentViews[matidx]) {
        let time = Date.now();
        
        for(let name in uniformNames) {
        
            if (!material.uniforms[name]) { 
                material.uniforms[name] = {value:0};
            }

            if(name === 'iResolution') {
                if(meshType === 'halfsphere' || meshType === 'circle') {
                    material.uniforms.iResolution.value = new THREE.Vector2(this.canvas.width,this.canvas.height);
                } else if (meshType !== 'plane') {
                    material.uniforms.iResolution.value = new THREE.Vector2(Math.max(this.canvas.width,this.canvas.height), this.canvas.width); //fix for messed up aspect ratio on vrscreen and sphere
                } else {
                    material.uniforms.iResolution.value = new THREE.Vector2(this.canvas.width, this.canvas.height); //leave plane aspect alone
                }
            } else if (name === 'iTime') {
                material.uniforms.iTime.value = (time-this.startTime)*0.001;
            } else if (name === 'iTimeDelta') {
                let t0 = time-this.lastTime;
                material.uniforms.iTimeDelta.value = (t0)*0.001;
                if(t0 > 5) {
                    this.lastTime = time;
                }
            } else if (name === 'iFrame') {
                material.uniforms.iFrame.value++;
            } else if (name === 'iFrameRate') {
                let t0 = time - this.lastFrame;
                material.uniforms.iFrameRate.value = 1/(t0*0.001);
                if(t0 > 5) { 
                    this.lastFrame = time;
                }
            } else if (name === 'iChannelTime') {
                let t = (time-this.startTime)*0.001;
                material.uniforms.iChannelTime.value.forEach((t,i)=>{
                    material.uniforms.iChannelTime.value[i] = t;
                });
            } else if (name === 'iDate') {
                let date = new Date();
                material.uniforms.iDate.value.x = date.getYear();
                material.uniforms.iDate.value.y = date.getMonth();
                material.uniforms.iDate.value.z = date.getDay();
                material.uniforms.iDate.value.w = date.getHours()*3600 + date.getMinutes()*60 + date.getSeconds();
            } else if (name === 'iMouse') {
                material.uniforms.iMouse.value = new THREE.Vector4(...this.mousexyzw);
            } else if (name === 'iMouseInput') {
                material.uniforms.iMouseInput.value = this.mouseclicked;
            } else if (name === 'iImage') {
                material.uniforms.iImage.value = new THREE.Texture(canvas);
            } else if (name === 'iAudio') {
                if(this.audio) { //using Sound.js
                    material.uniforms.iFFT.value = this.downsample(Array.from(this.audio.getAnalyzerData()),256);
                } else {
                    material.uniforms.iFFT.value = this.uniforms.iFFT.value;
                }
            } else if (this.uniformSettings[name]) { //arbitrary uniforms
                if(this.uniformSettings[name].callback) {
                    material.uniforms[name].value = this.uniformSettings[name].callback();
                }
            }
            
        }

    }

    //update all of the uniforms simultaneously to save time
    updateAllMaterialUniforms() {
        Object.keys(this.uniforms).forEach((name) => {
            let materialsfiltered = [];
            this.shaderSettings.filter((setting,j) => {
                if(setting.uniformNames.indexOf(name)>-1) {
                    materialsfiltered.push(this.materials[j]);
                    return true;
                }
            });     
            if(materialsfiltered.length > 0) {
                let value;
                if(name === 'iResolution') {
                    if(meshType === 'halfsphere' || meshType === 'circle') {
                        value = new THREE.Vector2(this.canvas.width,this.canvas.height);
                    } else if (meshType !== 'plane') {
                        value = new THREE.Vector2(Math.max(this.canvas.width,this.canvas.height), this.canvas.width); //fix for messed up aspect ratio on vrscreen and sphere
                    } else {
                        value = new THREE.Vector2(this.canvas.width, this.canvas.height); //leave plane aspect alone
                    }
                } else if (name === 'iTime') {
                    value = (time-this.startTime)*0.001;
                } else if (name === 'iTimeDelta') {
                    value = (time-this.lastTime)*0.001;
                    this.lastTime = time;
                } else if (name === 'iFrame') {
                    this.uniforms.iFrame.value++;
                    value = this.uniforms.iFrame.value;
                } else if (name === 'iFrameRate') {
                    value = 1/((time - this.lastFrame)*0.001);
                    this.lastFrame = time;
                } else if (name === 'iChannelTime') {
                    let t = (time-this.startTime)*0.001;
                    this.uniforms.iChannelTime.value.forEach((t,i)=>{
                        this.uniforms.iChannelTime.value[i] = t;
                    });
                    value = this.uniforms.iChannelTime.value;
                } else if (name === 'iDate') {
                    let date = new Date();
                    value = new THREE.Vector4(date.getYear(),date.getMonth(),date.getDay(),date.getHours()*60*60+date.getMinutes()*60+date.getSeconds());
                } else if (name === 'iMouse') {
                    value = new THREE.Vector4(...this.mousexyzw);
                } else if (name === 'iMouseInput') {
                    value = this.mouseclicked;
                } else if (name === 'iImage') {
                    value = new THREE.Texture(canvas);
                } else if (name === 'iAudio') {
                    if(this.audio) {//using Sound.js
                        value = Array.from(this.audio.getAnalyzerData().slice(0,256));
                    }
                } else if (this.uniformSettings[name]) { //arbitrary uniforms
                    if(this.uniformSettings[name].callback) {
                        value = this.uniformSettings[name].callback();
                    } else {
                        value = this.uniforms[name].value;
                    }
                } 
            
                materialsfiltered.forEach(material => {
                    if (!material.uniforms[name]) { 
                        material.uniforms[name] = {value:value};
                    } else material.uniforms[name].value = value;
                });
            }
        });
    }

    //applies to main shader
    setShader = (matidx=0, name='',vertexShader=``,fragmentShader=``,uniformNames=[],author='') => {
        this.shaderSettings[matidx].name = name;
        this.shaderSettings[matidx].vertexShader = vertexShader;
        this.shaderSettings[matidx].fragmentShader = fragmentShader;
        this.shaderSettings[matidx].uniformNames = uniformNames;
        this.shaderSettings[matidx].author = author;

        let uniforms = this.generateMaterialUniforms(this.shaderSettings[matidx]); //get base/invariant uniforms

        this.materials[matidx] = new THREE.ShaderMaterial({
            vertexShader: this.shaderSettings.vertexShader,
            fragmentShader: this.shaderSettings.fragmentShader,
            side: THREE.DoubleSide,
            transparent: true,
            uniforms:uniforms
        });

        this.updateMaterialUniforms(this.materials[matidx],uniformNames,this.currentViews[matidx]); //get latest data
        
        if(this.meshes[matidx]){
            this.meshes[matidx].material.dispose();
            this.meshes[matidx].material = this.materials[matidx];
        }
    }

    swapShader = (matidx=0,onchange=()=>{this.startTime=Date.now()}) => {

        let uniforms = this.generateMaterialUniforms(this.shaderSettings[matidx]); //get base/invariant uniforms

        this.materials[matidx] = new THREE.ShaderMaterial({
            vertexShader: this.shaderSettings[matidx].vertexShader,
            fragmentShader: this.shaderSettings[matidx].fragmentShader,
            side: THREE.DoubleSide,
            transparent: true,
            uniforms: uniforms
        });

        this.updateMaterialUniforms(); //get latest data

        if(this.meshes[matidx]){
            this.meshes[matidx].material.dispose();
            this.meshes[matidx].material = this.materials[matidx];
        }

        onchange();
    }

    setShaderFromText = (
        matidx=0,
        fragmentShaderText=this.defaultFragment,
        vertexShaderText=this.defaultVertex,
        name='',
        author='',
        onchange=()=>{this.startTime=Date.now()}
        ) => {

        this.fragment = fragmentShaderText;
        this.vertex = vertexShaderText;

        // Dynamically Extract Uniforms
        let regex = new RegExp('uniform (.*) (.*);', 'g')
        let result = [...fragmentShader.matchAll(regex)]
        let alluniforms = [];
        result.forEach(a => {
            if(a[1].includes('sampler')){
                this.uniforms[u] = {default:new Texture(uvmap),type:'t'};
                this.uniformSettings[u] = {default:new Texture(uvmap),type:'t'};
            } else if (a[1].includes('float')) {
                if(!this.uniforms[u]) {
                    this.uniforms[u] = {value:0};
                    this.uniformSettings[u] = {default:0,min:0,max:100,step:1};
                }
            }
            alluniforms.push(a[2].replace(/(\[.+\])/g, ''));
        });

        this.shaderSettings[matidx].name = name;
        this.shaderSettings[matidx].vertexShader = vertexShaderText;
        this.shaderSettings[matidx].fragmentShader = fragmentShaderText;
        this.shaderSettings[matidx].author = author;
        this.shaderSettings[matidx].uniformNames = alluniforms;

        this.swapShader(matidx,onchange);

    }

    generateGUI(uniformNames=this.uniformSettings.uniformNames,material=this.material){
        
        if(!this.gui) return undefined;
        
        let updateUniforms = (key,value) => {
            if (this.material.uniforms[key] == null) material.uniforms[key] = {};
            material.uniforms[key].value = value;
        }

        
        let folders = Object.keys(this.gui.__folders)
        if (!folders.includes('Uniforms')){
            this.gui.addFolder('Uniforms');
        }
        let paramsMenu = this.gui.__folders['Uniforms']

        this.guiControllers.forEach(c => {
            paramsMenu.remove(c)
        })
        this.guiControllers = [];        

        let keys = Object.keys(this.uniforms);
        uniformNames.forEach((name)=> {
            if(keys.indexOf(name) > -1){
                if(typeof this.uniforms[name].value !== 'object' && this.uniformSettings[name].min && this.uniformSettings[name].max && this.uniformSettings[name].step){
                    this.guiControllers.push(
                        paramsMenu.add(
                            this.uniforms, 
                            name, 
                            this.uniformSettings[name].min,
                            this.uniformSettings[name].max,
                            this.uniformSettings[name].step
                            ).onChange(
                                (val) => updateUniforms(name,val))
                            );
                }
            } 
        });
    }


    //test the renderer
    createRenderer(canvas=this.canvas) {
        this.gui;
        this.guiControllers = [];
        try{
            this.gui = new GUI({ autoPlace: false });
            this.generateGUI()
        } catch(err) {
            //probably not on main thread
        }

        /**
         * Scene
         */
        this.three.scene = new THREE.Scene()

        /**
         * Camera
         */

        this.baseCameraPos = new THREE.Vector3(0,0,3)
        this.camera = new THREE.PerspectiveCamera(75, canvas.offsetWidth/canvas.offsetHeight, 0.01, 1000)
        this.camera.position.z = this.baseCameraPos.z//*1.5

        /**
         * Texture Params
         */

        let containerAspect = canvas.offsetWidth/canvas.offsetHeight //this.appletContainer.offsetWidth/this.appletContainer.offsetHeight
        this.fov_y = this.camera.position.z * this.camera.getFilmHeight() / this.camera.getFocalLength();

        // Fit Screen
        this.three.meshWidth = this.fov_y * this.camera.aspect
        this.three.meshHeight = this.three.meshWidth/containerAspect

        // Renderer
        this.three.renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true, canvas:this.canvas } );
        this.three.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
        this.three.renderer.setSize( this.canvas.offsetWidth, this.canvas.offsetHeight );
        this.three.renderer.domElement.style.width = '100%'
        this.three.renderer.domElement.style.height = '100%'
        this.three.renderer.domElement.style.opacity = '0'
        this.three.renderer.domElement.style.transition = 'opacity 1s'

        // Controls
        this.three.controls = new OrbitControls(this.camera, this.three.renderer.domElement)
        this.three.controls.enablePan = true
        this.three.controls.enableDamping = true
        this.three.controls.enabled = true;
        this.three.controls.minPolarAngle = 2*Math.PI/6; // radians
        this.three.controls.maxPolarAngle = 4*Math.PI/6; // radians
        this.three.controls.minDistance = this.baseCameraPos.z; // radians
        this.three.controls.maxDistance = this.baseCameraPos.z*1000; // radians

        this.uniforms.iResolution = new THREE.Vector2(this.three.meshWidth, this.three.meshHeight); //Required for ShaderToy shaders

        // Animate
        this.startTime = Date.now();

        let render = () => {
            if (this.three.renderer.domElement != null){
 
                 let time = (Date.now() - this.startTime)/1000;
                 this.uniforms.iTimeDelta = time - this.uniforms.iTime;
                 this.uniforms.iTime = time;
                 this.uniforms.iFrame++;
                 this.uniforms.iFrameRate = 1/(this.uniforms.iTimeDelta*0.001);  
                 
                this.three.meshes.forEach(p => {
                    this.updateMaterialUniforms(p.material);
                });

                this.three.renderer.render( this.three.scene, this.camera )
            }    
        } 

        this.three.renderer.setAnimationLoop( render );

    }

    destroyRenderer() {
        this.three.renderer?.setAnimationLoop(null);
        for (let i = this.three.scene.children.length - 1; i >= 0; i--) {
            const object = this.three.scene.children[i];
            if (object.type === 'Mesh') {
                object.geometry.dispose();
                object.material.dispose();
            }
            this.three.scene.remove(object);
        }
        this.three.scene = null;
        this.three.renderer.domElement = null;
        this.three.renderer = null;
    }

}