const ElvOAction = require("../o-action").ElvOAction;
const ElvOFabricClient = require("../o-fabric");
const fs = require("fs");
const parser = require("xml2json");
const path = require("path");
const ElvOMutex = require("../o-mutex");
const { relativeTimeThreshold } = require("moment");


class ElvOManageCaptions extends ElvOAction  {
    
    ActionId() {
        return "manage_captions";
    };
    
    Parameters() {     
        return {
            "parameters": {
                action: {type: "string", required:true, values:["ADD","TRANSLATE", "CLEAR"]}, 
                identify_by_version: {type: "boolean", required:false, default: false}
            }
        };
    };
    
    IOs(parameters) {
        let inputs ={};
        let outputs = {};
        if (parameters.action == "TRANSLATE") {
            inputs.file_path = {type: "string", required: true};
            inputs.offset_sec = {type: "numeric", required: false, default: 0};
            inputs.force_offset = {type: "boolean", required: false, default: false};
            inputs.force_framerate = {type: "boolean", required: false, default: false};
            inputs.encoding_framerate = {type: "numeric", required: false, default: 24};
            inputs.playout_framerate = {type: "numeric", required: false, default: 24};
            inputs.output_file_path = {type: "string", required: false, default: null};
            inputs.source_type = {type: "string", required: false, default: null, values:["VTT","ITT","SRT", "SCC", "STL", "TTML", "SMPTE-TT 608"/*,"Lambda Cap"*/]};
            outputs.file_path = {type: "string"};
            outputs.offset_sec = {type: "numeric"};
            outputs.anomalies = {type: "array"};
        }
        if (parameters.action == "CLEAR") {
            inputs.offering_key = {type: "string", required:false, default: "default"};
            inputs.label  = {type: "string", required: false,  description: "Label to display for caption stream to be removed"};
            inputs.language = {type: "string", required: false,  description: "Language code for caption stream(s) to be removed"};
            inputs.stream_key =  {type: "string", required: false,  description: "Key for caption stream to be removed"};
            inputs.clear_all = {type: "boolean", required: false, default: false};
            if (parameters.identify_by_version) {
                inputs.mezzanine_object_version_hash = {type: "string", required: true};
            } else {
                inputs.mezzanine_object_id = {type: "string", required: true};
            }
            inputs.safe_update = {type: "boolean", required: false, default: false};
            inputs.private_key = {type: "password", required:false};
            inputs.config_url = {type: "string", required:false};
            outputs.mezzanine_object_version_hash = {type: "string"};
            outputs.removed_stream_keys = {type: "array"};
        }
        if (parameters.action == "ADD") {
            inputs.file_path = {type: "string", required: true};
            inputs.label  = {type: "string", required: true,  description: "Label to display for caption stream"};
            inputs.language = {type: "string", required: false,  description: "Language code for caption stream (some older players may use this as the label)"};
            inputs.stream_key =  {type: "string", required: false,  description: "Key for new caption stream (if omitted, will be generated from label and filename)"};
            if (parameters.identify_by_version) {
                inputs.mezzanine_object_version_hash = {type: "string", required: true};
            } else {
                inputs.mezzanine_object_id = {type: "string", required: true};
            }
            inputs.safe_update = {type: "boolean", required: false, default: false};
            inputs.private_key = {type: "password", required:false};
            inputs.config_url = {type: "string", required:false};
            inputs.offering_key = {type: "string", required:false, default: "default"};
            inputs.store_encrypted = {type: "boolean", required:false, default: false};
            inputs.forced = {type: "boolean", required:false, default: false, description: "Flag captions as forced subtitles"};
            inputs.is_default = {type: "boolean", required:false, default: false, description: "Set as default caption stream"};
            inputs.offset_sec = {type: "numeric", required: false, default: 0, description: "Number of seconds to add or (-) subtract from timestamps in captions file"};
            outputs.mezzanine_object_version_hash = {type: "string"};
            outputs.caption_key = {type: "string"};
        }
        return {inputs, outputs};
    };
    
    async Execute(handle, outputs) {
        let parameters = this.Payload.parameters;
        if (parameters.action == "TRANSLATE") {
            return this.executeTranslate(this.Payload.inputs, outputs);
        }
        if (parameters.action == "ADD") {
            return this.executeAdd(this.Payload.inputs, outputs);
        }
        if (parameters.action == "CLEAR") {
            return this.executeClear(this.Payload.inputs, outputs);
        }
        this.Error("Unknown action",parameters.action);
        return ElvOAction.EXECUTION_EXCEPTION;
    };
    
    
    executeTranslate(inputs, outputs){
        outputs.anomalies = [];
        let filepath = inputs.file_path;
        let captionsText;
        let extension;
        try {
            let sourceType = inputs.source_type &&  inputs.source_type.toLowerCase().replace(/^\./,"");
            extension = (path.basename(filepath).match(/\.([^.]+)$/) || ["",""])[1].toLowerCase();
            outputs.force_offset = inputs.force_offset;
            outputs.force_framerate = inputs.force_framerate;
            if (inputs.force_framerate)  {
                this.reportProgress("Playout framerate forced to match encoding framerate");
                inputs.playout_framerate = inputs.encoding_framerate;
            }
            if ((sourceType && (sourceType == "vtt")) || (extension == "vtt")) {
                captionsText = this.translateVTT(filepath, inputs.offset_sec, inputs.encoding_framerate, inputs.playout_framerate, outputs);
            }
            if ((sourceType && (sourceType == "itt")) || (extension == "itt")) {
                captionsText = this.translateITT(filepath, inputs.offset_sec, inputs.encoding_framerate, inputs.playout_framerate, outputs);
            }
            if ((sourceType && ((sourceType == "ttml") || (sourceType == "SMPTE-TT 608"))) || (extension == "xml")) {
                captionsText = this.translateSMPTE(filepath, inputs.offset_sec, inputs.encoding_framerate, inputs.playout_framerate, outputs);
            }
            if ((sourceType && (sourceType == "scc")) || (extension == "scc")) {
                captionsText = this.translateSCC(filepath, inputs.offset_sec, inputs.encoding_framerate, inputs.playout_framerate, outputs);
            }
            if ((sourceType && (sourceType == "srt")) || (extension == "srt")) {
                captionsText = this.translateSRT(filepath, inputs.offset_sec, inputs.encoding_framerate, inputs.playout_framerate, outputs);
            }
            if ((sourceType && (sourceType == "stl")) || (extension == "stl")) {
                captionsText = this.translateSTL(filepath, inputs.offset_sec, inputs.encoding_framerate, inputs.playout_framerate, outputs);
            }
            if (!captionsText) {               
                throw new Error("Unsupported format "+ (extension || sourceType));
            }
        } catch(err) {
            this.Error("Could not translate "+ filepath, err);
            if (err.message) {
                outputs.anomalies.push(err.message);
            } else {
                outputs.anomalies.push("Could not translate -" + err);
            }
            let usedOffset = (outputs.offset_sec != null) ? outputs.offset_sec : inputs.offset_sec;
            if (err.message  && err.message.match(/Timecode with offset is negative/) && !inputs.force_offset && (usedOffset < 0)) {
                this.reportProgress("re-trying with no-offset");
                inputs.offset_sec = 0;
                inputs.force_offset = true;
                return  this.executeTranslate(inputs, outputs)
            }
            return ElvOAction.EXECUTION_EXCEPTION;
        }
        let outputFilePath = inputs.output_file_path || (((extension && filepath.replace(/\.[^.]+$/, "")) || filepath) + "_converted.vtt");
        fs.writeFileSync(outputFilePath, captionsText);
        outputs.file_path = outputFilePath;
        return ElvOAction.EXECUTION_COMPLETE;
    };
    
    toTimecode(sec) {
        let hours   = Math.floor(sec / 3600); // get hours
        let minutes = Math.floor((sec - (hours * 3600)) / 60); // get minutes
        let seconds = sec - (hours * 3600) - (minutes * 60); //  get seconds
        
        // add 0 if value < 10; Example: 2 => 02
        if (hours   < 10) {hours   = "0"+hours;}
        if (minutes < 10) {minutes = "0"+minutes;}
        if (seconds < 10) {seconds = "0"+seconds.toFixed(3);} else {seconds = seconds.toFixed(3);} 
        return hours+':'+minutes+':'+seconds; // Return is HH : MM : SS
    };
    
    // "00:02:58:19" -> 178.79166666666666 
    // "01:01:49.083" -> 3709.083
    // "00:09:15;17" -> 555.7083333333334
    // "01:16:25,878" -> 4585.878
    fromTimecode(timecode, encodingFramerate) {
        if (!encodingFramerate) {
            encodingFramerate = 24;
        }
        let matcher = timecode.match(/([0-9]+):([0-9]+):([0-9]+)[\.,]([0-9]+)/);
        let time;
        if (!matcher) {
            matcher = timecode.match(/([0-9]+):([0-9]+):([0-9]+)[:;]([0-9]+)/);
            if (matcher) {
                time = parseInt(matcher[1]) * 3600 + parseInt(matcher[2]) * 60 + parseInt(matcher[3]) + parseInt(matcher[4]) / encodingFramerate;
            } else {
                throw new Error("Invalid timecode format " + timecode);
            }
        } else {
            time = parseInt(matcher[1]) * 3600 + parseInt(matcher[2]) * 60 + parseInt(matcher[3]) + parseInt(matcher[4]) / 1000;
        }
        if (!Number.isFinite(time)) {
            throw new Error("Invalid  timecode with offset " +timecode + "-> " + time);
        }
        return  time;
    };
    
    convertTimecode(timecode, offsetSec, encodingFramerate, playoutFramerate) {   
        //this.Debug("convertTimecode", {timecode, offsetSec, encodingFramerate, playoutFramerate});    
        let matcher = timecode.match(/([0-9]+):([0-9]+):([0-9]+)[\.,]([0-9]+)/);
        let time = this.fromTimecode(timecode, encodingFramerate);
        let adjustedTime = (time + offsetSec);
        if (!Number.isFinite(adjustedTime)) {
            throw new Error("Invalid  timecode with offset " +timecode +"-> " + adjustedTime);
        }
        if (adjustedTime < 0) {
            throw new Error("Timecode with offset is negative " +timecode +"/" + offsetSec.toString());
        }
        let scaledTime = adjustedTime / encodingFramerate * playoutFramerate
        return this.toTimecode( (time + offsetSec) / encodingFramerate * playoutFramerate );
    };
    
    parseSRTLine(line, offsetSec, encodingFramerate, playoutFramerate) {
        //8
        //01:03:48,491 --> 01:03:51,744
        //-Fui pescar em Cuernavaca.
        //-Claro que sim.
        if (!this.SRT_LINECOUNTER) {
            this.SRT_LINECOUNTER = 1;
        }
        let matcher = line.match(/([0-9:.;,]+) --> ([0-9:.;,]+)/);
        if (matcher) {
            return this.convertTimecode(matcher[1],  offsetSec, encodingFramerate, playoutFramerate) + " --> " + this.convertTimecode(matcher[2],  offsetSec, encodingFramerate, playoutFramerate); 
        } else {
            if (line.match(/^[0-9]+$/) && (parseInt(line) == this.SRT_LINECOUNTER )) {
                this.SRT_LINECOUNTER++;
                return null;
            }
        }
        let parsedLine = line.replace(/{(\/*[iub])}/g,"<$1>").replace(/^{\\[^}]+}/,"").replace(/{\an*[0-9]+}/g, "");
        return parsedLine;
    };
    
    parseVTTLine(line, offsetSec, encodingFramerate, playoutFramerate) {
        //10:01:38.625 --> 10:01:40.625
        let matcher = line.match(/([0-9:.;,]+) --> ([0-9:.;,]+)/);
        if (matcher) {
            return this.convertTimecode(matcher[1],  offsetSec, encodingFramerate, playoutFramerate) + " --> " + this.convertTimecode(matcher[2],  offsetSec, encodingFramerate, playoutFramerate); 
        } 
        return line;
    };
    
    translateVTT(filePath, offsetSec, encodingFramerate, playoutFramerate, outputs) {
        let lines = []; 
        let rawtext = fs.readFileSync(filePath, "utf-8");
        if (outputs) {
            outputs.offset_sec = offsetSec;
        }
        for (let line of rawtext.split(/\n/)) {
            lines.push(this.parseVTTLine(line, offsetSec, encodingFramerate, playoutFramerate));
        }
        return lines.join("\n");
    };
    
    translateSRT(filePath, offsetSec, encodingFramerate, playoutFramerate, outputs) {
        let lines = ["WEBVTT\n"]; 
        let rawtext = fs.readFileSync(filePath, "utf-8");
        if (outputs) {
            outputs.offset_sec = offsetSec;
        }
        for (let line of rawtext.split(/\n/)) {
            let parsedLine = this.parseSRTLine(line.trim(), offsetSec, encodingFramerate, playoutFramerate);
            if (parsedLine != null) {
                lines.push(parsedLine);
            }
        }
        return lines.join("\n");
    };


    getToDeepestSpan(text, section) {
        //this.Debug("getToDeepestSpan", text);
        if (!section) {
            section = text.match(/<span([^>]+?)>(.*?)<\/span>/);
        }
        if  (!section) {
            return null;
        }
        if (section[2].match(/<span/)) {
            return this.getToDeepestSpan(section[2]+"</span>");
        }
        if (section[1].match(/italic/)){
            return  {from: section[0], to: "__ITALIC_START__"+section[2]+"__ITALIC_END__"}; 
        } else {
            return {from: section[0], to: section[2]};
        }
    };
    
    translateITT(filePath, offsetSec, encodingFramerate, playoutFramerate, outputs)  {
        let rawtext = fs.readFileSync(filePath, "utf-8");
        
        let textLines = rawtext.split(/[\n\r]+/);
        let parsable = textLines.join("__LINEFEED__");
        parsable = parsable.replace(/<[bB][rR] *\/*> */g,"__BR__").replace(/<\/[bB][rR]> */g,"");
        
        //removes $ 
        parsable = parsable.replace(/\$/g,"__DOLLAR__");

        //removes the empty spans <span />
        parsable = parsable.replace(/<span[^>]*\/>/g,"");

        //ruby processing
        //<span ry:kind="rb">ら</span><span ry:kind="rt">・</span>
        //--><b>ら</b>
        parsable = parsable.replace(/<span +ry:kind="rb">([^<]+)<\/span><span ry:kind="rt">・<\/span>/g,"&lt;b&gt;$1&lt;/b&gt;");

        //<p><span style="italic"><span ry:kind="ruby" style="ruby-before-between"><span ry:kind="rb">冥</span><span ry:kind="rt">めい</span></span>王サウロンは人知れず⸺</span></p>
        //--> <i>冥(めい)</i>王サウロンは人知れず⸺
        parsable = parsable.replace(/<span +ry:kind="rt">([^<]+)<\/span>/g,"($1)");
        
        while  (true){
            let section = parsable.match(/<span([^>]+?)>(.*?)<\/span>/);
            if  (!section) {
                break;
            }
            let textSub = this.getToDeepestSpan(parsable, section);
            if (textSub) {
                parsable = parsable.replace(textSub.from, textSub.to);
            }
            /*
            let section = parsable.match(/<span([^>]+?)>(.*?)<\/span>/);
            if  (!section) {
                break;
            }
            if (section[1].match(/<span>/)) {

            }
            if (section[1].match(/italic/)){
                parsable = parsable.replace(section[0], "__ITALIC_START__"+section[2]+"__ITALIC_END__"); 
            } else {
                parsable = parsable.replace(section[0], section[2]); 
            }
            */
        }
        let textToParse = parsable.replace(/__LINEFEED__/g,"\n").replace(/__DOLLAR__/g,"$$");  
        let parsed = parser.toJson(textToParse, { object: true , reversible: true});
        let result = {};
        result.language_code = parsed.tt['xml:lang'];
        result.offset = parsed.tt.body.div.begin;
        let offsetSign = result.offset && (result.offset.match(/^-/) ? -1 : 1)
        let documentOffsetSec = result.offset && (Math.round(this.fromTimecode(result.offset)) * offsetSign);
        if ((offsetSec != null)  && (documentOffsetSec != null) && (offsetSec != documentOffsetSec)  && (!outputs || !outputs.force_offset) ) {
            this.reportProgress("Mismatched offset, using document", {document: documentOffsetSec, provided: offsetSec});
            offsetSec = documentOffsetSec;
        }
        if ((offsetSec == null)  &&  documentOffsetSec) {
            this.reportProgress("No offset provided, using document", {document: documentOffsetSec, provided: offsetSec});
            offsetSec = documentOffsetSec;
        }
        if (outputs) {
            outputs.offset_sec = offsetSec;
        }
        let documentFramerate;
        if (parsed.tt['ttp:frameRate'] && parsed.tt['ttp:frameRateMultiplier']){
            let frameRateMultiplier = parsed.tt['ttp:frameRateMultiplier'].split(" ")
            documentFramerate = parseInt(parsed.tt['ttp:frameRate']) * 1.0 * parseInt(frameRateMultiplier[0]) / parseInt(frameRateMultiplier[1]);
        }
        
        if (documentFramerate && (documentFramerate != playoutFramerate) && (!outputs || !outputs.force_offset) ) {
            this.reportProgress("Mismatched playout framerate, using document", {document: documentFramerate, provided: playoutFramerate});
            if (parsed.tt["ttp:dropMode"] != "nonDrop") {
                this.reportProgress("Non-drop, using specified playout", {document: documentFramerate, provided: playoutFramerate});
                playoutFramerate = documentFramerate;
                encodingFramerate = documentFramerate;
            } else {                
                this.reportProgress("Non-drop, using specified playout", {document: documentFramerate, provided: playoutFramerate});
                encodingFramerate = documentFramerate;
                playoutFramerate = parsed.tt['ttp:frameRate'];
            }
        }
        
        let rawLines = parsed.tt.body.div.p;
        let lines = ["WEBVTT\n"];
        if (!(rawLines instanceof Array)) {
            rawLines = [rawLines];
        }
        for (let rawLine of rawLines) {
            /* {
                style: 'basic',
                region: 'pop14',
                begin: '10:10:44:06',
                end: '10:10:46:23',
                'tts:origin': '10.00% 79.33%',
                'tts:extent': '95.00% 5.33%',
                '$t': "j'étais le juif de service, moi aussi."
            }
            to
            10:01:38.625 --> 10:01:40.625
            Composição e interpretação
            */
            //this.Debug("rawLine", rawLine);
            let text = this.getText(rawLine);
            
            if (text) {
                text = text.replace(/__BR__/g,"\n").replace(/__ITALIC_START__/g,"<i>").replace(/__ITALIC_END__/g,"</i>");
                text = text.split("\n").map(function(l){return l.trim()}).filter(function(l){return l}).join("\n");
                let entry = {
                    start: this.convertTimecode(rawLine.begin, offsetSec, encodingFramerate, playoutFramerate),
                    end: this.convertTimecode(rawLine.end, offsetSec, encodingFramerate, playoutFramerate),
                    text: text
                }
                
                lines.push("\n"+ entry.start+ " --> " + entry.end + "\n" + entry.text + "\n") 
            } else {
                if (rawLine["$t"]) {
                    this.reportProgress("parsing error", rawLine);
                    throw new Error("parsing error - " + JSON.stringify(rawLine));
                }
            }           
        }
        return lines.join("");
    };
    
    getText(rawLine) {
        //this.Debug("rawLine", rawLine);
        let text= "";
        if ((typeof rawLine) == "object") {
            for (let k in rawLine) {
                if (k  == "$t") {                      
                    let italic =  false;
                    for (let kk in rawLine) {
                        if ((kk !=  "$t") && (kk.toLowerCase().match(/italic/) || (((typeof rawLine[kk]) == "string") && rawLine[kk].toLowerCase().match(/italic/)))) {
                            italic=true;
                            break;
                        } 
                    }
                    if (italic) {
                        text += ("<i>"+ rawLine["$t"] + "</i>")
                    } else {
                        text += rawLine["$t"];
                    }
                    
                } else {
                    text += this.getText(rawLine[k]);
                }
            }            
            return text;
        } 
        if ((typeof rawLine) == "array") {
            for (let item of rawLine) {
                text += this.getText(rawLine[item]);
            }
        }
        if ((typeof rawLine) == "string") {            
            return "";
        }
        this.Debug("Line is not an object", rawLine)
        throw new Error("Line is not an object "+ rawLine);
    }
    
    translateSMPTE(filePath, offsetSec, encodingFramerate, playoutFramerate, outputs)  {
        let rawtext = fs.readFileSync(filePath, "utf-8");
        let textLines = rawtext.split(/[\n\r]+/);
        let parsable = textLines.join("__LINEFEED__");
        parsable = parsable.replace(/<[bB][rR] *\/*> */g,"__BR__").replace(/<\/[bB][rR]> */g,"");
        
        
        while  (true){
            let section = parsable.match(/<span([^>]+?)>(.*?)<\/span>/);
            if  (!section) {
                break;
            }
            if (section[1].match(/italic/)){
                parsable = parsable.replace(section[0], "__ITALIC_START__"+section[2]+"__ITALIC_END__"); 
            } else {
                parsable = parsable.replace(section[0], section[2]); 
            }
        }
        let textToParse = parsable.replace(/__LINEFEED__/g,"\n")
        let parsed = parser.toJson(textToParse, { object: true, reversible: true });
        let result = {};
        result.language_code = parsed.tt['xml:lang'];
        //result.offset = parsed.tt.body.div.begin;
        if (outputs) {
            outputs.offset_sec = offsetSec;
        }
        let rawLines = parsed.tt.body.div.p;
        if (!(rawLines instanceof Array)) {
            rawLines = [rawLines];
        }
        let lines = ["WEBVTT\n"];
        let entries = [];
        for (let rawLine of rawLines) {
            /* {
                style: 'basic',
                region: 'pop14',
                begin: '10:10:44:06',
                end: '10:10:46:23',
                'tts:origin': '10.00% 79.33%',
                'tts:extent': '95.00% 5.33%',
                '$t': "j'étais le juif de service, moi aussi."
            }
            to
            10:01:38.625 --> 10:01:40.625
            Composição e interpretação
            */
            let text = this.getText(rawLine);
            if (text) {
                text = text.replace(/__BR__/g,"\n").replace(/__ITALIC_START__/g,"<i>").replace(/__ITALIC_END__/g,"</i>");
                text = text.split("\n").map(function(l){return l.trim()}).filter(function(l){return l}).join("\n");
            }
            let entry = {
                start: this.convertTimecode(rawLine.begin, offsetSec, encodingFramerate, playoutFramerate),
                end: this.convertTimecode(rawLine.end, offsetSec, encodingFramerate, playoutFramerate),
                text: text
            }
            
            if (!entry.text) {
                this.reportProgress("parsing error", rawLine);
            }
            entries.push(entry);
            //lines.push("\n"+ entry.start+ " --> " + entry.end + "\n" + entry.text + "\n"); 
        }
        let previousStart;
        let previousEnd;
        for  (let entry of entries) {
            if ((entry.start != previousStart) || (entry.end != previousEnd)) {
                previousStart = entry.start; 
                previousEnd = entry.end;
                lines.push("\n"+ entry.start+ " --> " + entry.end + "\n" + entry.text + "\n"); 
            } else {
                lines.push(entry.text+ "\n");
            }
        }
        return lines.join("");
    };
    
    translateSCC(filePath, offsetSec, encodingFramerate, playoutFramerate, outputs)  {
        let debugMode = this.Payload.parameters.debug;
        try {
            if (outputs) {
                outputs.offset_sec = offsetSec;
            }
            let rawtext = fs.readFileSync(filePath, "utf-8");
            let rawLines = rawtext.split(/\n/);
            let entries = [];
            for (let rawLine of rawLines) {
                if (!rawLine || !rawLine.match(/[a-z0-9A-Z]+/)) {
                    continue;
                }
                let matcher = rawLine.match(/([0-9]+:[0-9]+:[0-9]+[;:.][0-9]+)\t* *(.*)/);
                if (matcher) {            
                    if (debugMode) {this.Debug("matcher[2]", matcher[2])};
                    let  rawPairs = matcher[2].split(" ")                
                    let pairString = "";
                    let textString = "";
                    for (let item of rawPairs) {
                        let pair =  this.parseSCCPair(item);
                        textString = textString + pair;
                        pairString = pairString + "("+item+":"+pair + ") ";
                    }
                    if (debugMode) {this.Debug("pairs", pairString)};
                    let text = this.addNonCompliantAccents(textString).replace(/[\t ]+\n/g,"\n").replace(/\n+/g,"\n").replace(/^[\t ]*\n/, "");
                    if (debugMode) {this.Debug("Accented text", text)};
                    let entry = {
                        start: matcher[1],
                        text
                    };
                    entries.push(entry);
                } else {
                    this.reportProgress("error", rawLine);
                }
            }
            for (let i=1; i < entries.length; i++) {
                entries[i-1].end = entries[i].start;
            }
            let lines =  ["WEBVTT\n"];
            for (let entry of entries.filter(function(entry) {return entry.text;})) {
                let entryStart = this.convertTimecode(entry.start, offsetSec, encodingFramerate, playoutFramerate);
                let entryEnd = entry.end ? this.convertTimecode(entry.end, offsetSec - 0.001, encodingFramerate, playoutFramerate) : this.convertTimecode(entry.start, 1, encodingFramerate, playoutFramerate); // -0.001 is to avoid collisions between lines
                lines.push("\n"+ entryStart+ " --> " + entryEnd + "\n" + entry.text + "\n");
            }
            return lines.join("");
        } catch(errSCC) {
            if ((offsetSec != 0) && !outputs.force_offset && errSCC.message && errSCC.message.match(/Timecode with offset is negative/)){
                this.reportProgress("SCC with negative offset timecodes are typically not offset, using 0 instead");
                return this.translateSCC(filePath, 0, encodingFramerate, playoutFramerate, outputs); 
            } else {
                throw errSCC;
            }
        }
    };
    
    parseSCCPair(item) {
        let charInt = parseInt(item, 16) % (256 * 128);
        if  ((charInt >= 8192)  && (charInt <= 32767)) { //bit 13 or 14 are set
            return  this.mapSCCBasicNorthAmericanCharacter(item.slice(0, 2)) + this.mapSCCBasicNorthAmericanCharacter(item.slice(2, 4));
        }
        if  (((charInt >= 4352)  && (charInt <= 4607)) || ((charInt >= 6400)  && (charInt <= 6655))) { //first byte of 0x11 or 0x19 
            return  this.mapSCCSpecialNorthAmericanCharacter(item.slice(2, 4));
        }
        if  (((charInt >= 4608)  && (charInt <= 4863)) || ((charInt >= 6656)  && (charInt <= 6911))) { //has a first byte of 0x12 or 0x1A 
            return  this.mapSCCExtendedWesternEuropeanCharacterSPFR(item.slice(2, 4));
        }
        if  (((charInt >= 4864)  && (charInt <= 5119)) || ((charInt >= 6912)  && (charInt <= 7167))) {  //has a first byte of 0x13 or 0x1B
            return  this.mapSCCExtendedWesternEuropeanCharacterPTGEDA(item.slice(2, 4));
        }
        if  (((charInt >= 5120)  && (charInt <= 5631)) || ((charInt >= 7168)  && (charInt <= 7679))) { //0x14 (CC1) or 0x1c (CC2) or 0x15 (CC3) or 0x1D (CC4)
            return  this.mapSCCControl_1(item.slice(2, 4));
        }
        if  (((charInt >= 5888)  && (charInt <= 6143)) || ((charInt >= 7936)  && (charInt <= 8191))) {  //0x17 (CC1/3) or 0x1F (CC2/4)
            return  this.mapSCCControl_2(item.slice(2, 4));
        }
        this.reportProgress("Non-compliant SCCPair", item);
        return "";
    };
    
    mapSCCControl_1(item) { //94xx,  //14xx
        let charInt = parseInt(item, 16) % 128;
        let mapSCC = {
            32: "", //resume caption loading
            33: "", //backspace
            36: "\n", //delete to end of row
            37: "\n\n", //roll up 2
            38: "\n\n\n", //roll up 3
            39: "\n\n\n\n", //roll up 4
            40: "", //flash  caption
            41: "\n", //resume direct captioning
            42: "\n", //text restart
            44: "", //	erase display memory
            45: "\n", //carriage return
            46: "", //erase non displayed memory
            47:"", //end of caption
            49: " ", // tab offset 1 (add spacing)
            50: "  ", // tab offset 2 (add spacing)
            51: "   ", //tab offset 3 (add spacing)
            64: "\n",//not in spec  - from bb2
            78: "\n", //not in spec
            80: "\n", //not in spec
            82: "\n", //not in spec - from sls
            84: "\n", //not in spec - from sls
            86: "\n", //not in spec - from bb2
            88:"", //not in spec/
            90:"\n", //not in spec
            92:"", //not in spec
            94:"", //not in spec
            96:"\n", //not in spec
            110: "\n", //not in spec
            112: "\n", //not in spec
            114: "\n", //not in spec
            116: "\n", //not in spec
            118: "\n", //not in spec
            120: "\n", //not in spec
            122: "\n", //not in spec
            124: "\n", //not in spec
            126: "\n" //not in spec
        };
        let  specialChar = mapSCC[charInt] 
        if  (specialChar != null) {
            return specialChar
        }
        this.reportProgress("mapSCCControl_1 anomaly", charInt);
        return ""; 
    };
    
    mapSCCControl_2(item) {
        let charInt = parseInt(item, 16) % 128;
        let mapSCC = {
            33: "	", //tab offset 1
            34: "		", //tab offset 2
            35: "			", //tab offset 3
        };
        let  specialChar = mapSCC[charInt] 
        if  (specialChar != null) {
            return specialChar
        }
        this.reportProgress("mapSCCControl_2 anomaly", charInt);
        return ""; 
    };
    
    mapSCCBasicNorthAmericanCharacter(item) {
        let mapSCC = {
            0: "", 
            27: "'",
            42: "á",
            92: "é",
            94: "í",
            95: "ó",
            123: "ç",
            124: "÷",
            125: "Ñ",
            126: "ñ",
            127: "█" //Solid block
        };
        let charInt = parseInt(item, 16) % 128;
        let specialChar = mapSCC[charInt];
        if (specialChar != null) {
            return specialChar;
        }
        if (charInt <= 122){
            return String.fromCharCode(charInt);
        }
        this.reportProgress("mapSCCBasicNorthAmericanCharacter anomaly", charInt);
        return ""; //not sure what this is supposed to be
    };
    
    mapSCCSpecialNorthAmericanCharacter(item) {
        let charInt = parseInt(item, 16) % 128;
        let mapSCC = {
            32: " ",
            46: " ",
            48: "®",
            49:	"°",    
            50: "½",
            51:"¿",
            52:"™",
            53:"¢",
            54:"£",
            55:"♪",
            56:"à",
            57: " ", //non breaking space
            58:"è",
            59:"â",
            60:"ê",
            61:"î",
            62:"ô",
            63:"û",
            78: "",//not part of the spec
            80: "",//not part of the spec
            82: "",//not part of the spec
            84: "\n",//not part of the spec
            86: "",//not part of the spec
            96: " ", //not part of the spec  - Step brothers
            112: "\n", //not part of the spec
            114: "\n", //not part of the spec
            116: "\n", //not part of the spec
            118: " ", //not part of the spec
            120: " " //not part of the spec
        };
        let specCar = mapSCC[charInt] ;
        if (specCar != null) {
            return specCar;
        }
        this.reportProgress("mapSCCSpecialNorthAmericanCharacter anomaly", charInt);
        return "";
    };
    
    addNonCompliantAccents(text) {
        text = text.replace(/EÉÉ/g, "É");
        text = text.replace(/ÉÉ/g, "É");
        text = text.replace(/EÊÊ/g, "Ê");
        text = text.replace(/ÊÊ/g, "Ê");
        text = text.replace(/EÈÈ/g, "È");
        text = text.replace(/ÈÈ/g, "È");
        text = text.replace(/EËË/g, "Ë");
        text = text.replace(/ËË/g, "Ë");
        text = text.replace(/AÀÀ/g, "À");
        text = text.replace(/ÀÀ/g, "À");
        text = text.replace(/AÂÂ/g,"Â");
        text = text.replace(/ÂÂ/g,"Â");
        text = text.replace(/AÄÄ/g,"Ä")
        text = text.replace(/ÄÄ/g,"Ä")
        text = text.replace(/AÅÅ/g,"Å");
        text = text.replace(/ÅÅ/g,"Å");
        text = text.replace(/AÃÃ/g, "Ã");
        text = text.replace(/ÃÃ/g, "Ã");
        text = text.replace(/IÏÏ/g,"Ï");
        text = text.replace(/ÏÏ/g,"Ï");
        text = text.replace(/IÎÎ/g,"Î");
        text = text.replace(/ÎÎ/g,"Î");
        text = text.replace(/IÍÍ/g,"Í");
        text = text.replace(/ÍÍ/g,"Í");
        text = text.replace(/IÌÌ/g,"Ì");
        text = text.replace(/ÌÌ/g,"Ì");
        text = text.replace(/OÔÔ/g,"Ô");
        text = text.replace(/ÔÔ/g,"Ô");
        text = text.replace(/OÓÓ/g, "Ó");
        text = text.replace(/ÓÓ/g, "Ó");
        text = text.replace(/OÒÒ/g, "Ò");
        text = text.replace(/ÒÒ/g, "Ò");
        text = text.replace(/OÕÕ/g, "Õ");
        text = text.replace(/ÕÕ/g, "Õ");
        text = text.replace(/OÖÖ/g, "Ö");
        text = text.replace(/ÖÖ/g, "Ö");
        text = text.replace(/UÙÙ/g, "Ù");
        text = text.replace(/ÙÙ/g, "Ù");
        text = text.replace(/UÛÛ/g, "Û");
        text = text.replace(/ÛÛ/g, "Û");
        text = text.replace(/UÜÜ/g,"Ü");
        text = text.replace(/ÜÜ/g,"Ü");
        text = text.replace(/UÚÚ/g, "Ú");
        text = text.replace(/ÚÚ/g, "Ú");
        text = text.replace(/CÇÇ/g,"Ç");
        text = text.replace(/ÇÇ/g,"Ç");
        text = text.replace(/NÑÑ/g,"Ñ");
        text = text.replace(/ÑÑ/g,"Ñ");
        text = text.replace(/uùù/g,"ù");
        text = text.replace(/ùù/g,"ù");
        text = text.replace(/uûû/g,"û");
        text = text.replace(/ûû/g,"û");
        text = text.replace(/uüü/g, "ü");
        text = text.replace(/üü/g, "ü");
        text = text.replace(/uúú/g,"ú");
        text = text.replace(/úú/g,"ú");
        text = text.replace(/eéé/g,"é") 
        text = text.replace(/éé/g,"é") 
        text = text.replace(/eëë/g, "ë");
        text = text.replace(/ëë/g, "ë");
        text = text.replace(/eèè/g, "è");
        text = text.replace(/èè/g, "è");
        text = text.replace(/eêê/g, "ê");
        text = text.replace(/êê/g, "ê");
        text = text.replace(/aàà/g, "à");
        text = text.replace(/àà/g, "à");
        text = text.replace(/aââ/g, "â");
        text = text.replace(/ââ/g, "â");
        text = text.replace(/aáá/g,"á");
        text = text.replace(/áá/g,"á");
        text = text.replace(/aåå/g,"å");
        text = text.replace(/åå/g,"å");
        text = text.replace(/aãã/g, "ã");
        text = text.replace(/ãã/g, "ã");
        text = text.replace(/aää/g, "ä");
        text = text.replace(/ää/g, "ä");
        text = text.replace(/oôô/g, "ô");
        text = text.replace(/ôô/g, "ô");
        text = text.replace(/oóó/g, "ó");
        text = text.replace(/óó/g, "ó");
        text = text.replace(/oòò/g,"ò");
        text = text.replace(/òò/g,"ò");
        text = text.replace(/iïï/g,"ï");
        text = text.replace(/ïï/g,"ï");
        text = text.replace(/iîî/g,"î");
        text = text.replace(/îî/g,"î");
        text = text.replace(/iíí/g,"í");
        text = text.replace(/íí/g,"í");
        text = text.replace(/iìì/g,"ì");
        text = text.replace(/ìì/g,"ì");
        text = text.replace(/eëë/g, "ë");
        text = text.replace(/ëë/g, "ë");
        text = text.replace(/cçç/g, "ç");
        text = text.replace(/çç/g, "ç");
        text = text.replace(/nññ/,"ñ");
        text = text.replace(/ññ/,"ñ");
        text = text.replace(/\t\t\t\t/g,"\n");
        text = text.replace(/\t\t/g,"\n");
        text = text.replace(/\n+/g,"\n");
        text = text.replace(/^\n/,"");
        text = text.replace(/  /g," ");
        text = text.replace(/¿¿/g,"¿");       
        text = text.replace(/!¡¡/g,"¡");
        text = text.replace(/¡¡/g,"¡");
        return text;
    };
    
    mapSCCExtendedWesternEuropeanCharacterSPFR(item) {
        let charInt = parseInt(item, 16) % 128;
        let mapSCC = {
            32:"Á",
            33: "É", 
            34: "Ó",
            35:	"Ú",
            36: "Ü",
            37:	"ü",
            38:	"´",
            39:	"¡",
            40:	"*",
            41:	"'",
            42:	"─",
            43:	"©",
            44:	"℠",
            45:	"·",
            46:	"“",
            47:	"”",
            48: "À",
            49: "Â",
            50: "Ç",
            51: "È",
            52: "Ê",
            53: "Ë",
            54: "ë",
            55: "Î",
            56: "Ï",
            57:	"ï",
            58: "Ô",
            59: "Ù",
            60: "ù",
            61: "Û",
            62: "«",
            63: "»",
            80: "", //not in spec
            82: "",
            84: ""
        };
        let specCar = mapSCC[charInt] ;
        if  (specCar != null) {
            return specCar;
        }
        this.reportProgress("mapSCCExtendedWesternEuropeanCharacterSPFR anomaly", charInt);
        return "";
    };
    
    
    mapSCCExtendedWesternEuropeanCharacterPTGEDA(item) {
        let charInt = parseInt(item, 16) % 128;
        let mapSCC = { //13xx, 93xx
            32:"Ã",
            33:"ã",
            34:"Í",
            35:"Ì",
            36:"ì",
            37:"Ò",
            38:"ò",
            39:"Õ",
            40:"õ",
            41:"{",
            42:"}",
            43:"\\",
            44:"^",
            45: "_",
            46:"|",
            47:"~",
            48:"Ä",
            49:"ä",
            50:"Ö",
            51:"ö",
            52:"ß",
            53:"¥",
            54:"¤",
            55:"│",
            56:"Å",
            57: "å",
            58:"Ø",
            59:"ø",
            60:"┌",
            61: "┐",
            62:"└",
            63:"┘", 
            96: "\n", //not in spec -- bb2
            110: "\n", //not in spec
            112: "", //not in spec
            114: "", //not in spec
            116: "", //not in spec
            118: "\n", //not in spec  -- bb2
            120:"", //not in spec
            122:"", //not in spec
            124:"", //not in spec
            126:"" //not in spec
        };
        let  specCar = mapSCC[charInt];
        if (specCar != null) {
            return specCar;
        }
        this.reportProgress("mapSCCExtendedWesternEuropeanCharacterPTGEDA anomaly", charInt);
        return  "";
    };
    
    preSTLconversions(separator) { 
        return [
            {from: new RegExp(String.fromCharCode(separator)+String.fromCharCode(separator)+String.fromCharCode(separator),"g"), to: "\n"},
            {from: new RegExp(String.fromCharCode(separator),"g")+"-", to: "\n-"},
            {from: new RegExp("\\."+String.fromCharCode(separator),"g"), to: ".\n"},
            {from: new RegExp("!"+String.fromCharCode(separator),"g"), to: "!\n"},
            {from: new RegExp("\\?"+String.fromCharCode(separator),"g"), to: "?\n"},
            {from: new RegExp(";"+String.fromCharCode(separator),"g"), to: ";\n"},
            {from: new RegExp(":"+String.fromCharCode(separator),"g"), to: ":\n"},
            {from: new RegExp(","+String.fromCharCode(separator),"g"), to: ",\n"},
            {from: new RegExp(String.fromCharCode(separator)+String.fromCharCode(separator)+String.fromCharCode(separator)+String.fromCharCode(separator)+".*","g"), to: "\n"},
        ];
    };
    
    postSTLconversions(separator) {
        return [          
            //{from: new RegExp(String.fromCharCode(separator),"g"), to: " "},
            {from: new RegExp("\r.*","g"), to: ""},
            {from: new RegExp("\n\n\n.*","g"), to: ""},
            {from: new RegExp("\n\n\n.*","g"), to: ""},
            //{from: new RegExp(String.fromCharCode(4),"g"), to: ""},
            //{from: new RegExp(String.fromCharCode(5),"g"), to: ""}
        ];
    };
    
    languageSTLconversions(separator) {
        return {            
            "21" /*portuguese*/: [
                {from: new RegExp(String.fromCharCode(separator)+"ao","g"), to: "ão"},
                {from: new RegExp(String.fromCharCode(separator)+"a","g"), to: "á"},
                {from: new RegExp(String.fromCharCode(separator)+"c","g"), to: "ç"},
                {from: new RegExp(" "+String.fromCharCode(separator)+"e ","g"), to: " é "},
                {from: new RegExp(String.fromCharCode(separator)+"e","g"), to: "ê"},
                {from: new RegExp(String.fromCharCode(separator)+"i","g"), to:"í"},
                {from: new RegExp(String.fromCharCode(separator)+"u","g"), to: "ú"}
            ],
            "01": [], //Albanian
            "02": [], //Breton
            "03": [], //Catalan
            "04": [], //Croatian
            "05": [], //Welsh
            "06": [], //Czech
            "07": [], //"Danish",
            "1D": [], //"Dutch",
            "08": [], //"German",
            "1E": [], //"Norwegian",
            "09": [], //"English",
            "1F": [], //"Occitan",
            "0A": [], //"Spanish",
            "20": [], //"Polish",
            "0B": [], //"Esperanto",  
            "37": [], //"Reserved",
            "0C": [], //"Estonian",
            "22": [], //"Romanian",
            "38": [], //"national",
            "0D": [], //"Basque",
            "23": [], //"Romansh",
            "0E": [], //"Faroese",
            "24": [], //"Serbian",
            "0F": [], //"French",
            "25": [], //"Slovak",
            "10": [], //"Frisian",
            "26": [], //"Slovenian",
            "11": [], //"Irish",
            "27": [], //"Finnish",
            "12": [], //"Gaelic",
            "28": [], //"Swedish",
            "13": [], //"Galician",
            "29": [], //"Turkish",
            "14" /*"Icelandic"*/: [
                {from: new RegExp("i"+String.fromCharCode(separator)+"i","g"), to:"iði"},
                {from: new RegExp(String.fromCharCode(separator)+"y","g"),to:"ý"},
                {from: new RegExp(String.fromCharCode(separator)+"o","g"), to: "ö"},
                {from: new RegExp(String.fromCharCode(separator)+"i","g"), to:"í"},
                {from: new RegExp(String.fromCharCode(separator)+"e","g"), to:"é"},
                {from: new RegExp(String.fromCharCode(separator)+"a","g"), to: "á"},
                {from: new RegExp("v"+String.fromCharCode(separator)+"m","g"), to:"væm"},
                {from: new RegExp("f"+String.fromCharCode(separator)+"l","g"), to:"fæl"},
                {from: new RegExp("l"+String.fromCharCode(separator)+"k","g"), to:"læk"}, //flækingur
                {from: new RegExp("v"+String.fromCharCode(separator)+"r","g"), to:"vær"}, //væri
                {from: new RegExp("n"+String.fromCharCode(separator)+"t","g"), to:"næt"}, //
                {from: new RegExp("h"+String.fromCharCode(separator)+"t","g"), to:"hæt"},// hætta
                {from: new RegExp("r"+String.fromCharCode(separator)+"d","g"), to:"ræd"},// hrædd
                {from: new RegExp(String.fromCharCode(separator)+"t","g"), to:"æt"},// ætla
                {from: new RegExp(String.fromCharCode(separator)+String.fromCharCode(separator)+"e","g"), to:"æ"},// ættara
                {from: new RegExp("a"+String.fromCharCode(separator),"g"), to:"að"},
                {from: new RegExp("e"+String.fromCharCode(separator),"g"), to:"eð"},
                {from: new RegExp("i"+String.fromCharCode(separator),"g"), to:"ið"},
                {from: new RegExp(String.fromCharCode(separator)+"u","g"), to:"ú"},
                {from: new RegExp(String.fromCharCode(separator)+"l","g"), to:"þ"},
                {from: new RegExp("󅊄","g"), to: "ð"}
            ],
            "2A": [], //"Flemish",
            "15": [], //"Italian",
            "2B": [], //"Wallon"
        };
    };
    /* spec at https://tech.ebu.ch/docs/tech/tech3264.pdf */
    translateSTL(filePath, offsetSec, encodingFramerate, playoutFramerate, outputs)  {
        let rawASCII = fs.readFileSync(filePath, "binary");
        let rawtext = fs.readFileSync(filePath, "binary");
        let gsiBlock = rawtext.substring(0, 1023);
        
        let languageCode = gsiBlock.substring(14, 16);
        let countryCode = gsiBlock.substring(274,277);
        let separator = rawtext.charCodeAt(1024+126) || 65533;
        //console.log("GSI", {gsiBlock, languageCode, countryCode, separator});
        let i  = 1024;
        let entries = [];
        while (i < rawtext.length) {
            let tti = rawtext.substring(i, i + 127);
            let ttiASCII = rawASCII.substring(i, i + 127);
            let raw_text = tti.substring(11,127).replace(new RegExp(String.fromCharCode(separator)+"+$"),"")
            let raw_chars = [];
            for (let c=0; c < raw_text.length;c++) {
                raw_chars.push({c: raw_text.charAt(c), n:raw_text.charCodeAt(c)});
            }
            let text  = raw_text;
            for (let conversion of this.preSTLconversions(separator)) {
                text = text.replaceAll(conversion.from, conversion.to);
            }
            for (let conversion of (this.languageSTLconversions(separator)[languageCode] || [])) {
                text = text.replaceAll(conversion.from, conversion.to);
            }
            for (let conversion of this.postSTLconversions(separator)) {
                text = text.replaceAll(conversion.from, conversion.to);
            }
            let line = {
                raw: tti, 
                start: ("00"+ ttiASCII.charCodeAt(5)).slice(-2) + ":" + ("00"+ ttiASCII.charCodeAt(6)).slice(-2) + ":" +  ("00"+ ttiASCII.charCodeAt(7)).slice(-2) + ":"+ ("00"+ ttiASCII.charCodeAt(8)).slice(-2),
                end: ("00"+ ttiASCII.charCodeAt(9)).slice(-2) + ":" + ("00"+ ttiASCII.charCodeAt(10)).slice(-2) + ":" +  ("00"+ ttiASCII.charCodeAt(11)).slice(-2) + ":"+ ("00"+ ttiASCII.charCodeAt(12)).slice(-2),
                text: text,
                raw_text: raw_text
            };
            entries.push(line);
            this.reportProgress("line", line);
            i += 128;
        }
        
        let lines =  ["WEBVTT\n"];
        this.Info("Ignoring offset for stl format",  offsetSec);
        if (!outputs || !outputs.force_offset) {
            this.reportProgress("Using 0 has stl seems to not have an offset, use force_offset to overrid")
            offsetSec = 0; //stl seems to not have an offset
        } else {
            this.reportProgress("force_offset was set, so using provided offset instead of 0")
        }
        if (outputs) {
            outputs.offset_sec = offsetSec;
        }
        encodingFramerate = 24;
        playoutFramerate = 24;
        for (let entry of entries) {
            let entryStart = this.convertTimecode(entry.start, offsetSec, encodingFramerate, playoutFramerate);
            let entryEnd = this.convertTimecode(entry.end, offsetSec, encodingFramerate, playoutFramerate);
            lines.push("\n"+ entryStart+ " --> " + entryEnd + "\n" + entry.text + "\n");
        }
        return lines.join("");
    };
    
    
    
    
    async executeAdd(inputs, outputs) {
        try {
            let client;
            if (!this.Payload.inputs.private_key && !this.Payload.inputs.config_url){
                client = this.Client;
            } else {
                let privateKey = this.Payload.inputs.private_key || this.Client.signer.signingKey.privateKey.toString();
                let configUrl = this.Payload.inputs.config_url || this.Client.configUrl;
                client = await ElvOFabricClient.InitializeClient(configUrl, privateKey)
            }
            
            const encrypt = inputs.store_encrypted;
            let objectId = inputs.mezzanine_object_id || client.utils.DecodeVersionHash(inputs.mezzanine_object_version_hash).objectId;
            const libraryId = await this.getLibraryId(objectId, client);
            if (!libraryId) {
                throw (new Error("Could not retrieve library for " + objectId));
            }
            const offeringKey = inputs.offering_key;
            const filePath = inputs.file_path;
            const fileName = path.basename(filePath);
            const isDefault = inputs.is_default;
            const forced = inputs.forced;
            const language = inputs.language || ElvOManageCaptions.LANGUAGES[inputs.label];
            const label = inputs.label + ((forced) ? "_forced" : "");
            const timeShift = inputs.offset_sec;
            const streamKey = inputs.stream_key;
            
            await  this.acquireMutex(objectId);
            
            let finalData;
            if (timeShift != 0) {
                finalData = this.translateVTT(filePath, timeShift, 24, 24);
            } else {
                finalData = fs.readFileSync(filePath);;
            }
            let writeToken = await this.getWriteToken({
                client,
                libraryId,
                objectId
            });
            
            let uploadPartResponse = await client.UploadPart({
                libraryId,
                objectId,
                writeToken,
                data: finalData,
                encryption: encrypt ? "cgck" : "none"
            });
            let partHash = uploadPartResponse.part.hash;
            let finalizeResponse = await client.FinalizeContentObject({
                libraryId,
                objectId,
                writeToken,
                commitMessage: "Captions uploaded as new part for " + label
            });
            this.ReportProgress("Captions uploaded as new part: " + partHash);
            let hashAfterUpload = finalizeResponse.hash;
            
            // wait for publish to finish before re-reading metadata
            let publishFinished = false;
            let latestHash;
            this.reportProgress("waiting for publish to finish...");
            while (!publishFinished) {
                latestHash = await this.getVersionHash({libraryId, objectId, client});
                if(latestHash === hashAfterUpload) {
                    publishFinished = true;
                } else {
                    this.Debug("Waiting 15 seconds and checking again if publish is complete");
                    await this.sleep(15 * 1000);
                }
            }
            
            // =======================================
            // add metadata for caption stream
            // =======================================
            
            // reload metadata (now includes updated '/eluv-fb.parts' metadata from captions upload)
            let metadata = await this.getMetadata({
                client,
                libraryId,
                versionHash: hashAfterUpload
            });
            
            let offeringMetadata = metadata.offerings[offeringKey];
            
            
            //find if new caption overlaps with existing caption file
            try {
                if (offeringMetadata && offeringMetadata.media_struct ) {
                    for (let streamId in offeringMetadata.media_struct.streams) {
                        if (streamId.match(/^captions-/)) {
                            let stream = offeringMetadata.media_struct.streams[streamId];
                            if  ((stream.label == label) || ((stream.language == language) && ((stream.forced == true) == forced))) {
                                this.reportProgress("Removing overlapping caption file for "+ label, streamId);
                                delete  offeringMetadata.media_struct.streams[streamId];
                                delete offeringMetadata.playout.streams[streamId];
                            }
                        }
                    }
                }
            } catch(errOverlap) {
                this.Error("Could not remove overlap", errOverlap);
            }


            // create stream key
            const slugInput = streamKey || ("captions-" + label + fileName);
            
            let captionStreamKey = this.slugit(slugInput);
            let captionRepKey = captionStreamKey + "-vtt"; // representation is VTT, append as suffix as convention
            
            // copy temporal info from video stream
            let vidStream;
            for (let streamId in offeringMetadata.media_struct.streams) {
                if (offeringMetadata.media_struct.streams[streamId].codec_type == "video") {
                    vidStream = offeringMetadata.media_struct.streams[streamId];
                    break;
                }
            }
            const timeBase = vidStream.duration.time_base;
            const durationRat = vidStream.duration.rat;
            const durationTs = vidStream.duration.ts;
            const rate = vidStream.rate;
            
            // construct metadata for caption stream media_struct
            
            const mediaStructStream = {
                bit_rate: 100,
                codec_name: "none",
                codec_type: "captions",
                default_for_media_type: isDefault,
                duration: {
                    time_base: timeBase,
                    ts: durationTs
                },
                label: label,
                language: language,
                optimum_seg_dur: {
                    "time_base": timeBase,
                    "ts": durationTs
                },
                rate: rate,
                sources: [
                    {
                        duration: {
                            time_base: timeBase,
                            ts: durationTs
                        },
                        entry_point: {
                            rat: "0",
                            time_base: timeBase
                        },
                        source: partHash,
                        timeline_end: {
                            rat: durationRat,
                            time_base: timeBase
                        },
                        timeline_start: {
                            rat: "0",
                            time_base: timeBase
                        }
                    }
                ],
                start_time: {
                    time_base: timeBase,
                    ts: 0
                },
                time_base: timeBase
            };
            
            if (forced) {
                mediaStructStream.forced = true;
            }
            
            // construct metadata for caption stream playout
            
            let playoutStream = {
                encryption_schemes: {},
                representations: {}
            };
            playoutStream.representations[captionRepKey] = {
                bit_rate: 100,
                media_struct_stream_key: captionStreamKey,
                type: "RepCaptions"
            };
            
            // merge into object offering metadata
            offeringMetadata.media_struct.streams[captionStreamKey] = mediaStructStream;
            offeringMetadata.playout.streams[captionStreamKey] = playoutStream;
            
            // write back to object
            writeToken = await this.getWriteToken({
                client, objectId, libraryId
            });
            await client.ReplaceMetadata({
                libraryId: libraryId,
                objectId: objectId,
                writeToken: writeToken,
                metadataSubtree:  "offerings/" + offeringKey,
                metadata: offeringMetadata,
                client
            });
            
            let response = await this.FinalizeContentObject({
                libraryId: libraryId,
                objectId: objectId,
                writeToken: writeToken,
                commitMessage: "Caption stream added using stream key: " + captionStreamKey,
                client
            });
            outputs.caption_key = captionStreamKey;
            outputs.mezzanine_object_version_hash = response.hash;
            
            this.ReportProgress("Caption stream added using stream key: " + captionStreamKey, response.hash);
        } catch(err) {
            this.releaseMutex();
            this.Error("Adding captions failed", err);
            return ElvOAction.EXECUTION_EXCEPTION;
        }
        this.releaseMutex();
        return ElvOAction.EXECUTION_COMPLETE
    };
    
    
    async executeClear(inputs, outputs) {
        try {
            let client;
            if (!this.Payload.inputs.private_key && !this.Payload.inputs.config_url){
                client = this.Client;
            } else {
                let privateKey = this.Payload.inputs.private_key || this.Client.signer.signingKey.privateKey.toString();
                let configUrl = this.Payload.inputs.config_url || this.Client.configUrl;
                client = await ElvOFabricClient.InitializeClient(configUrl, privateKey)
            }
            
            let objectId = inputs.mezzanine_object_id || client.utils.DecodeVersionHash(inputs.mezzanine_object_version_hash).objectId;
            const libraryId = await this.getLibraryId(objectId, client);
            if (!libraryId) {
                throw (new Error("Could not retrieve library for " + objectId));
            }
            const offeringKey = inputs.offering_key;
            let streamKeys = [];
            if (inputs.stream_key) {
                streamKeys.push(inputs.stream_key);
            }
            
            
            await  this.acquireMutex(objectId)
            let offeringData = await this.getMetadata({
                client,
                libraryId,
                objectId,
                metadataSubtree: "offerings/"+offeringKey
            });
            
            if  (inputs.clear_all) {
                for (let streamId in offeringData.media_struct.streams) {
                    if (streamId.match(/^captions-/)) {
                        streamKeys.push(streamId);
                        this.reportProgress("All captions streams are to be removed", streamId);
                    }
                }
            } else {
                for (let streamId in offeringData.media_struct.streams) {
                    let streamData = offeringData.media_struct.streams[streamId];
                    if  (!inputs.stream_key && inputs.label && (streamData.label == inputs.label) ){
                        streamKeys.push(streamId);
                        this.reportProgress("Captions stream matches label "+ inputs.label, streamId);
                        continue;
                    }
                    if  (!inputs.stream_key && inputs.language && (streamData.language == inputs.language)) {
                        streamKeys.push(streamId);
                        this.reportProgress("Captions stream matches language "+ inputs.language, streamId);
                        continue;
                    }
                }
            }
            if  (streamKeys.length == 0) {
                this.ReportProgress("No captions streams to remove");
                this.releaseMutex()
                return ElvOAction.EXECUTION_FAILED;
            } else {
                this.ReportProgress("Captions streams to removed", streamKeys);
            }
            for (let captionStreamKey  of streamKeys) {
                // Delete caption stream from metadata
                delete offeringData.media_struct.streams[captionStreamKey];
                delete offeringData.playout.streams[captionStreamKey];
            }
            let writeToken = await this.getWriteToken({
                client,
                libraryId,
                objectId
            });
            
            await  client.ReplaceMetadata({
                writeToken,
                libraryId,
                objectId,
                metadataSubtree: "offerings/"+offeringKey,
                metadata: offeringData
            });
            
            
            let response = await this.FinalizeContentObject({
                libraryId: libraryId,
                objectId: objectId,
                writeToken: writeToken,
                commitMessage: (streamKeys.length == 1) ? ("Removed captions  stream " + streamKeys[0])  : ("Removed " + streamKeys.length + " captions streams") ,
                client
            });
            outputs.removed_stream_keys = streamKeys;
            outputs.mezzanine_object_version_hash = response.hash;
            
            this.ReportProgress("Caption streams removed " + streamKeys.length, response.hash);
        } catch(err) {
            this.releaseMutex();
            this.Error("Removing captions failed", err);
            return ElvOAction.EXECUTION_EXCEPTION;
        }
        this.releaseMutex();
        return ElvOAction.EXECUTION_COMPLETE
    };
    
    releaseMutex() {
        if  (this.SetMetadataMutex) {
            ElvOMutex.ReleaseSync(this.SetMetadataMutex); 
            this.ReportProgress("Mutex released");
        }
    };
    
    async acquireMutex(objectId) {
        if  (this.Payload.inputs.safe_update) {
            this.ReportProgress("Reserving mutex");
            this.SetMetadataMutex = await ElvOMutex.WaitForLock({name: objectId, holdTimeout: 120000}); 
            this.ReportProgress("Mutex reserved", this.SetMetadataMutex);
            return this.SetMetadataMutex
        }
        return null;
    };
    
    slugit(str) {
        return str.toLowerCase().replace(/ /g, "-").replace(/[^a-z0-9\-]/g,"");
    };
    
    
    static LANGUAGES = {
        "Afghan": "ps",
        "Afghan / Pashto": "ps",
        "Afrikaans": "af",
        "Albanian": "sq",
        "Arabic": "ar",
        "Azerbaijani": "az",
        "Bangla": "bn",
        "Bangla / Bengali": "bn",
        "Basque": "eu",
        "Bengali": "bn",
        "Bosnian": "bs",
        "Breton":"br",
        "Bulgarian": "bg",
        "Burmese": "my",
        "Cambodian": "km",
        "Catalan": "ca",
        "Chinese (Hong Kong)":	"zh-hk",
        "Chinese (PRC)": "zh-cn",
        "Chinese (Mandarin, PRC)": "zh-cn",
        "Chinese (Singapore)":	"zh-sg",
        "Chinese (Taiwan)":	"zh-tw",
        "Chinese (Taiwanese)":	"zh-tw",
        "Chinese (Cantonese)": "zh-hk",
        "Chinese (Mandarin)": "zh-cn",
        "Chinese (Mandarin, Taiwanese)": "zh-tw",
        "Chinese (Mandarin Simplified)": "zh-hans",
        "Chinese (Mandarin Simplified) [Text]": "zh-hans",
        "Chinese (Mandarin Traditional)": "zh-hant",
        "Chinese (Mandarin Traditional) [Text]": "zh-hant",
        "Chinese - Traditional": "zh-hant",
        "Chinese - Simplified": "zh-hans",
        "Croatian":	"hr",
        "Czech": "cs",
        "Danish": "da",
        "Dutch (Belgium)":	"nl-be",
        "Dutch (Standard)":	"nl",
        "Dutch (Flemish)":	"nl-be",
        "Dutch (Netherlands)": "nl",
        "Dutch":	"nl",
        "English (UK)": "en-uk",
        "English": "en",
        "English (United States)": "en-us", 
        "English (Australia)": "en-au",
        "English (Belize)":	"en-bz",
        "English (Canada)":	"en-ca",
        "English (Ireland)": "en-ie",
        "English (Jamaica)": "en-jm",
        "English (New Zealand)": "en-nz",
        "English (South Africa)": "en-za",
        "English (Trinidad)": "en-tt",
        "Estonian": "et",  
        "Farsi": "fa",
        "Finnish": "fi", 
        "French": "fr",
        "French (Parisian)": "fr",
        "French (Canadian)": "fr-ca",
        "Français (Canada)": "fr-ca",
        "French (Belgium)":	"fr-be",
        "French (Luxembourg)":	"fr-lu",
        "French (Standard)":	"fr",
        "French - Continental": "fr",
        "French (Continental)": "fr",
        "French (Switzerland)":	"fr-ch",
        "Georgian": "ka",   
        "German (Germany)": "de",
        "German (Austria)":	"de-at",
        "German (Liechtenstein)": "de-li",
        "German (Luxembourg)": "de-lu",
        "German (Standard)":	"de",
        "German (Switzerland)": "de-ch",
        "German (Swiss)":"de-ch",
        "German": "de",
        "Greek": "el",
        "Hebrew": "he",
        "Hindi": "hi",
        "Hungarian": "hu",
        "Icelandic": "is",
        "Indonesian": "id",  
        "Indonesian / Bahasa": "id",
        "Bahasa Indonesia": "id", 
        "Italian": "it",  
        "Italian (Standard)": "it",
        "Italian (Switzerland)": "it-ch",
        "Japanese": "ja",
        "Kazakh": "kk",
        "Khmer": "km",
        "Korean": "ko",
        "Kurdish": "ku",
        "Laothian": "lo",
        "Latvian": "lv",
        "Latvian (Lettish)": "lv",
        "Lettish": "lv",
        "Lithuanian": "lt",
        "Macedonian": "mk",
        "Malay": "ms",
        "Malagasy": "mg",
        "Malayalam": "ml",
        "Manx": "gv",
        "Maori": "mi",
        "Marathi": "mr",
        "Moldavian": "mo",
        "Mongolian": "mn",
        "Nauvhal": "nwi", //ISO 639-3, no ISO 639-1 code
        "Nawal": "nwi",
        "Nivai": "nwi",
        "Nivhaal": "nwi",
        "None": "none", 
        "M&E": "none",
        "Norwegian": "no",
        "Northern Sotho": "nso", //ISO 639-2, no ISO 639-1 code
        "Nepali": "ne",
        "Pashto": "ps",
        "Pedi": "nso",   //alternate name for Northern Sotho
        "Polish": "pl",
        "Portuguese (Brazil)": "pt-br",
        "Portuguese (Portugal)": "pt",
        "Portuguese": "pt",
        "Romanian": "ro",
        "Romanian (Republic of Moldova)": "ro-md",
        "Romany": "rom", //iso ISO 639-2  - no ISO 639-1
        "Russian (Russia)": "ru",
        "Russian (Republic of Moldova)": "ru-md",
        "Russian (Ukraine)": "ru-uk",
        "Russian": "ru",
        "Sepedi": "nso", //alternate name for Northern Sotho
        "Serbian": "sr",
        "Serbo-Croatian": "sh",
        "Slovak": "sk",
        "Slovakian": "sk",
        "Slovenian": "sl",
        "Slovene": "sl",
        "Somali": "so",
        "Sotho, Southern": "st",
        "Spanish (Argentinean)": "es-ar",
        "Spanish (Castilian)": "es-es",
        "Spanish (Latin Am)": "es-419",
        "Spanish (Bolivia)": "es-bo",
        "Spanish (Chile)": "es-cl",
        "Spanish (Chilean)": "es-cl",
        "Spanish (Colombia)": "es-co",
        "Spanish (Costa Rica)": "es-cr",
        "Spanish (Dominican Republic)": "es-do",
        "Spanish (Ecuador)": "es-ec",
        "Spanish (El Salvador)": "es-sv",
        "Spanish (Guatemala)": "es-gt",
        "Spanish (Honduras)": "es-hn",
        "Spanish (Mexico)": "es-mx",
        "Spanish (Mexican)": "es-mx",
        "Spanish (Nicaragua)": "es-ni",
        "Spanish (Panama)": "es-pa",
        "Spanish (Paraguay)": "es-py",
        "Spanish (Peru)": "es-pe",
        "Spanish (Puerto Rico)": "es-pr",
        "Spanish (Spain)": "es",
        "Spanish (Uruguay)": "es-uy",
        "Spanish (Venezuela)": "es-ve",
        "Spanish": "es",
        "Swedish": "sv",
        "Tagalog": "tl",
        "Tamil": "ta",
        "Telugu":  "te",
        "Thai": "th",
        "Turkish": "tr",
        "Ukrainian": "uk",
        "Urdu": "ur",
        "Vietnamese": "vi"    
    };

    static LANGUAGE_LABELS = {
        "ps": "Pashto",
        "af": "Afrikaans",
        "sq": "Albanian",
        "ar": "Arabic",
        "az": "Azerbaijani",
        "bn": "Bangla / Bengali",
        "eu": "Basque",
        "bs": "Bosnian",
        "br": "Breton",
        "bg": "Bulgarian",
        "my": "Burmese",
        "km": "Cambodian",
        "ca": "Catalan",
        "zh-hk": "Chinese (Cantonese)",
        "zh-cn": "Chinese (PRC)",
        "zh-sg": "Chinese (Singapore)",
        "zh-tw": "Chinese (Taiwan)",
        "zh-hans": "Chinese (Mandarin Simplified)",
        "zh-hant": "Chinese (Mandarin Traditional)",
        "hr": "Croatian",
        "cs": "Czech",
        "da": "Danish",
        "nl-be": "Dutch (Flemish)",
        "nl": "Dutch (Netherlands)",
        "en-uk": "English (UK)",
        "en": "English",
        "en-us": "English (United States)",
        "en-au": "English (Australia)",
        "en-bz": "English (Belize)",
        "en-ca": "English (Canada)",
        "en-ie": "English (Ireland)",
        "en-jm": "English (Jamaica)",
        "en-nz": "English (New Zealand)",
        "en-za": "English (South Africa)",
        "en-tt": "English (Trinidad)",
        "et": "Estonian",
        "fa": "Farsi",
        "fi": "Finnish",
        "fr": "French (Parisian)",
        "fr-ca": "French (Canadian)",
        "fr-be": "French (Belgium)",
        "fr-lu": "French (Luxembourg)",
        "fr-ch": "French (Switzerland)",
        "ka": "Georgian",
        "de": "German (Germany)",
        "de-at": "German (Austria)",
        "de-li": "German (Liechtenstein)",
        "de-lu": "German (Luxembourg)",
        "de-ch": "German (Swiss)",
        "el": "Greek",
        "he": "Hebrew",
        "hi": "Hindi",
        "hu": "Hungarian",
        "is": "Icelandic",
        "id": "Indonesian / Bahasa",
        "it": "Italian",
        "it-ch": "Italian (Switzerland)",
        "ja": "Japanese",
        "kk": "Kazakh",
        "ko": "Korean",
        "ku": "Kurdish",
        "lo": "Laothian",
        "lv": "Latvian",
        "lt": "Lithuanian",
        "mk": "Macedonian",
        "ms": "Malay",
        "mg": "Malagasy",
        "ml": "Malayalam",
        "gv": "Manx",
        "mi": "Maori",
        "mr": "Marathi",
        "mo": "Moldavian",
        "mn": "Mongolian",
        "nwi": "Nauvhal",
        "none": "None",
        "no": "Norwegian",
        "nso": "Sepedi",
        "ne": "Nepali",
        "pl": "Polish",
        "pt-br": "Portuguese (Brazil)",
        "pt": "Portuguese (Portugal)",
        "ro": "Romanian",
        "ro-md": "Romanian (Republic of Moldova)",
        "rom": "Romany",
        "ru": "Russian (Russia)",
        "ru-md": "Russian (Republic of Moldova)",
        "ru-uk": "Russian (Ukraine)",
        "sr": "Serbian",
        "sh": "Serbo-Croatian",
        "sk": "Slovakian",
        "sl": "Slovene",
        "so": "Somali",
        "st": "Sotho, Southern",
        "es-ar": "Spanish (Argentinean)",
        "es-es": "Spanish (Castilian)",
        "es-419": "Spanish (Latin Am)",
        "es-bo": "Spanish (Bolivia)",
        "es-cl": "Spanish (Chilean)",
        "es-co": "Spanish (Colombia)",
        "es-cr": "Spanish (Costa Rica)",
        "es-do": "Spanish (Dominican Republic)",
        "es-ec": "Spanish (Ecuador)",
        "es-sv": "Spanish (El Salvador)",
        "es-gt": "Spanish (Guatemala)",
        "es-hn": "Spanish (Honduras)",
        "es-mx": "Spanish (Mexico)",
        "es-ni": "Spanish (Nicaragua)",
        "es-pa": "Spanish (Panama)",
        "es-py": "Spanish (Paraguay)",
        "es-pe": "Spanish (Peru)",
        "es-pr": "Spanish (Puerto Rico)",
        "es": "Spanish",
        "es-uy": "Spanish (Uruguay)",
        "es-ve": "Spanish (Venezuela)",
        "sv": "Swedish",
        "tl": "Tagalog",
        "ta": "Tamil",
        "te": "Telugu",
        "th": "Thai",
        "tr": "Turkish",
        "uk": "Ukrainian",
        "ur": "Urdu",
        "vi": "Vietnamese"
      };
    
    static VERSION = "0.5.0";
    static REVISION_HISTORY = {
        "0.0.1": "Initial release",
        "0.0.2": "Adds support for stl",
        "0.0.3": "Improves parsing for itt",
        "0.0.4": "Improves handling of XML br tag",
        "0.0.5": "Handles span of plain text",
        "0.0.6": "Improves Handling of italic in span",
        "0.0.7": "Improves of br tags in ITT (supports for <br /> - with spaces)",
        "0.0.8": "Adds support for dropframe timecodes",
        "0.1.0": "Normalizes logging",
        "0.1.1": "Adds support for SRT, stops reliance on  solely on file extension for type evaluation",
        "0.1.2": "Marked label _force when forced captions",
        "0.1.3": "Fixes multi-line  entry for SMPTE",
        "0.1.4": "Fixes handling   of <BR /> for SMPTE",
        "0.1.5": "Supports forcing of provided offset, returns used offset as output",
        "0.1.6": "Returns anomalies as output",
        "0.1.7": "Fixes doubling up of italic text",
        "0.1.8": "Preprocess the span sections out of xml formats (ITT and TTML)",
        "0.1.9": "Preprocess non-italic span sections out of xml formats (ITT and TTML)",
        "0.2.0": "Adds a few language codes ",
        "0.2.1": "With ITT do not convert empty line",
        "0.2.2": "Removes overlapping caption files when adding a new one",
        "0.2.3": "Cleans up empty spans as they are not supported by XML parser in ITT",
        "0.2.4": "Added Slovene and Slovakian",
        "0.2.5": "Added a dozen uncommon languages, fixed SCC support for French and Spanish",
        "0.2.6": "Added expected non-conforming SCC character configurations",
        "0.2.7": "Tweaked parsing of XML to ensure simple span are correctly processed",
        "0.2.8": "Avoids issue  with SCC when finished by non blank line",
        "0.2.9": "Uses 0 for offset when encountering negative offset timecode in SCC processing",
        "0.3.0": "Adds handling of formatting in SRT",
        "0.3.1": "Changes SCC behavior of 9452 and 9454",
        "0.3.2": "Removes overlapping caption files when adding a new one (fix)",
        "0.3.3": "Address case of SMPTE files with single caption line",
        "0.3.4": "Changes SCC behavior of 9440, 9456, 13e0 and 1376",
        "0.3.5": "Adds option to force the specified framerate over the document specified one",
        "0.3.6": "Avoids collisions of label when adding captions",
        "0.3.7": "Adds reverse lookup for language labels",
        "0.3.8": "Fixes collisions avoidance of label when adding captions",
        "0.3.9": "Fixes a few label cross reference for languages",
        "0.4.0": "Added Mexican Spanish code",
        "0.4.1": "Adds support for non-drop timecodes in SCC",
        "0.4.2": "Changes label from Flemish and Cantonese",
        "0.4.3": "Adds a catch all for non compliant SCC pair",
        "0.4.4": "Fixed escaping of $ sign when processing ITT",
        "0.4.5": "Adds an auto retry with no offset when timecode are negative",
        "0.4.6": "Change M&E label to None",
        "0.4.7": "Fix  retrying of negative timecodes with 0 offset",
        "0.4.8": "Forcing offset to 0 on retry",
        "0.4.9": "Adds treatment of {\an2} in SRT",
        "0.5.0": "Enforce forced_framerate with all formats"
    };
};


if (ElvOAction.executeCommandLine(ElvOManageCaptions)) {
    ElvOAction.Run(ElvOManageCaptions);
} else {
    module.exports=ElvOManageCaptions;
}