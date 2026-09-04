const ElvOAction = require("../o-action").ElvOAction;
const ElvOFabricClient = require("../o-fabric");
const ElvOMutex = require("../o-mutex");

class ElvOActionManageMezzanine extends ElvOAction  {
    ActionId() {
        return "manage_mezzanine";
    };
    
    
    Parameters() {
        return {
            parameters: {
                action: {type: "string", values:["UNIFY_AUDIO_DRM_KEYS", "CLIP", "ADD_CLEAR_OFFERING", "REMOVE_PLAYOUT_FORMATS_FROM_OFFERING"], required: true},
                identify_by_version: {type: "boolean", required:false, default: false}
            }
        };
    };
    
    IOs(parameters) {
        let inputs = {
            private_key: {type: "password", "required":false},
            config_url: {type: "string", "required":false}
        };
        let outputs = {};
        if (parameters.action == "UNIFY_AUDIO_DRM_KEYS") {
            inputs.safe_update = {type: "boolean", required: false, default: false};
            if (!parameters.identify_by_version) {
                inputs.mezzanine_object_id =  {type: "string", required: true};
            } else {
                inputs.mezzanine_object_version_hash = {type: "string", required: true};
            }
            outputs.mezzanine_object_version_hash = {type: "string"};
        }
        if (parameters.action == "CLIP") {
            inputs.safe_update = {type: "boolean", required: false, default: false};
            if (!parameters.identify_by_version) {
                inputs.mezzanine_object_id =  {type: "string", required: true};
            } else {
                inputs.mezzanine_object_version_hash = {type: "string", required: true};
            }
            inputs.offering = {type: "string", required: false, default: "default"};
            inputs.entry_point_sec = {type: "numeric", required: false, default: null};
            inputs.entry_point_rat = {type: "string", required: false, default: null};
            inputs.exit_point_sec = {type: "numeric", required: false, default: null};
            inputs.exit_point_rat = {type: "string", required: false, default: null};
            outputs.mezzanine_object_version_hash = {type: "string"};
        }
        if (parameters.action == "ADD_CLEAR_OFFERING") {
            inputs.safe_update = {type: "boolean", required: false, default: false};
            if (!parameters.identify_by_version) {
                inputs.mezzanine_object_id =  {type: "string", required: true};
            } else {
                inputs.mezzanine_object_version_hash = {type: "string", required: true};
            }
            inputs.source_offering = {type: "string", required: false, default: "default"};
            inputs.playout_formats = {type: "array", required: false, default: ["dash-clear", "hls-clear"]};
            inputs.offering = {type: "string", required: false, default: "default"};
            outputs.mezzanine_object_version_hash = {type: "string"};
        }
        if (parameters.action == "REMOVE_PLAYOUT_FORMATS_FROM_OFFERING") {
            inputs.safe_update = {type: "boolean", required: false, default: false};
            if (!parameters.identify_by_version) {
                inputs.mezzanine_object_id =  {type: "string", required: true};
            } else {
                inputs.mezzanine_object_version_hash = {type: "string", required: true};
            }
            inputs.offering = {type: "string", required: false, default: "default"};
            inputs.playout_formats = {type: "array", required: true};
            outputs.mezzanine_object_version_hash = {type: "string"};
        }
        
        return {inputs, outputs};
    };
    
    async Execute(handle, outputs) {
        try {
            let client;
            let privateKey;
            let configUrl;
            if (!this.Payload.inputs.private_key && !this.Payload.inputs.config_url){
                client = this.Client;
            } else {
                privateKey = this.Payload.inputs.private_key || this.Client.signer.signingKey.privateKey.toString();
                configUrl = this.Payload.inputs.config_url || this.Client.configUrl;
                client = await ElvOFabricClient.InitializeClient(configUrl, privateKey)
            }
            
            let objectId = this.Payload.inputs.mezzanine_object_id;
            let versionHash = this.Payload.inputs.mezzanine_object_version_hash;
            if (!versionHash) {
                versionHash = await this.getVersionHash({objectId, client});
                this.Debug("Mezzanine object version hash: " + versionHash, objectId);
            } else {
                objectId = client.utils.DecodeVersionHash(versionHash).objectId;
            }
            let libraryId = await this.getLibraryId(objectId, client);
            
            if (this.Payload.parameters.action == "UNIFY_AUDIO_DRM_KEYS") {
                return await this.executeUnifyAudioDRMKeys({objectId, libraryId, versionHash, client}, outputs);
            }
            if (this.Payload.parameters.action == "CLIP") {
                return await this.executeClipMezzanine({objectId, libraryId, versionHash, client}, outputs);
            }
            if (this.Payload.parameters.action == "ADD_CLEAR_OFFERING") {
                return await this.addClearOffering({objectId, libraryId, versionHash, client}, outputs);
            }
            if (this.Payload.parameters.action == "REMOVE_PLAYOUT_FORMATS_FROM_OFFERING") {
                return await this.addClearOffering({objectId, libraryId, versionHash, client}, outputs);
            }
        } catch(errExecute) {
            this.releaseMutex();
            this.Error("Execution error", errExecute);
            return ElvOAction.EXECUTION_EXCEPTION;
        }
    };
    
    async removePlayoutFormatsFromOffering({objectId, libraryId, versionHash, client}, outputs) {
        this.reportProgress("Remove playout formats from offering in "+ objectId);
        await this.acquireMutex(objectId);
        let inputs = this.Payload.inputs;
        let formats = this.Payload.playout_formats;
        let changed = false;
        let sourceOffering = await  this.getMetadata({objectId, libraryId, versionHash, client, metadataSubtree:"offerings/"+inputs.offering});
        for (let format of formats) {
            if (sourceOffering.playout_formats[format]) {
                delete sourceOffering.playout_formats[format];
                changed = true;
                this.reportProgress("Removing playout format " +format + " from offering " + inputs.offering);
            } else {
                this.reportProgress("Playout format " +format + "not present in offering " + inputs.offering);
            }
        }

        if (!changed) {
            outputs.mezzanine_object_version_hash = versionHash;
            this.ReportProgress("No changes to make");
            this.releaseMutex();
            return ElvOAction.EXECUTION_FAILED;
        }
                   
        let writeToken = await this.getWriteToken({
            libraryId: libraryId,
            objectId: objectId,
            versionHash,
            client: client
        });
        
        await client.ReplaceMetadata({
            objectId,
            libraryId,
            metadataSubtree: "offerings/"+  inputs.offering, 
            writeToken,
            metadata: sourceOffering,
            client
        });
        
        let msg = "Removed some playout formats from offering "+inputs.offering;
        let response = await this.FinalizeContentObject({
            libraryId: libraryId,
            objectId: objectId,
            writeToken: writeToken,
            commitMessage: msg,
            client
        });
        if (response && response.hash) {
            this.ReportProgress(msg)
        } else {
            throw new Error("Failed to remove playout formats");
        }
        outputs.mezzanine_object_version_hash = response.hash;
        this.releaseMutex();
        return ElvOAction.EXECUTION_COMPLETE;   

    };
    
    async addClearOffering({objectId, libraryId, versionHash, client}, outputs) {
        this.reportProgress("Add clear offering to "+ objectId);
        await this.acquireMutex(objectId);
        let inputs = this.Payload.inputs;
        let formats = this.Payload.inputs.playout_formats;
        let sourceOffering = await  this.getMetadata({objectId, libraryId, versionHash, client, metadataSubtree:"offerings/"+inputs.source_offering});
        if (inputs.offering != inputs.source_offering) {
            for (let format in sourceOffering.playout.playout_formats) {
                if (!formats.includes(format)) {
                    delete sourceOffering.playout.playout_formats[format];
                }
            }
        }
        this.Debug("modified source", sourceOffering);
        sourceOffering.drm_optional = true;
        for (let format of formats) {
            if (format  == "dash-clear") {
                sourceOffering.playout.playout_formats[format] = {drm: null, protocol: {min_buffer_length: 2, type: "ProtoDash"}};
                continue;
            }
            if (format  == "hls-clear") {
                sourceOffering.playout.playout_formats[format] = {drm: null, protocol: {min_buffer_length: 2, type: "ProtoHls"}};
                continue;
            }
        }
                   
        let writeToken = await this.getWriteToken({
            libraryId: libraryId,
            objectId: objectId,
            versionHash,
            client: client
        });
        
        await client.ReplaceMetadata({
            objectId,
            libraryId,
            metadataSubtree: "offerings/"+  inputs.offering, 
            writeToken,
            metadata: sourceOffering,
            client
        });
        
        let msg = "Added clear offering "+ inputs.offering;
        let response = await this.FinalizeContentObject({
            libraryId: libraryId,
            objectId: objectId,
            writeToken: writeToken,
            commitMessage: msg,
            client
        });
        if (response && response.hash) {
            this.ReportProgress(msg)
        } else {
            throw new Error("Failed to add clear offering");
        }
        outputs.mezzanine_object_version_hash = response.hash;
        this.releaseMutex();
        return ElvOAction.EXECUTION_COMPLETE;   

    };

    async executeUnifyAudioDRMKeys({objectId, libraryId, versionHash, client}, outputs) {
        this.reportProgress("Make all audio streams use same DRM keys in object "+ objectId);
        await this.acquireMutex(objectId);
        let offerings = await this.getMetadata({objectId, libraryId, versionHash, client, metadataSubtree: "offerings"});
        
        if (!offerings || (Object.keys(offerings).length == 0)) {
            throw new Error("no offerings found in metadata");
        }
        // loop through offerings
        let  changed = 0;
        for (let offeringKey in offerings) {
            let offering = offerings[offeringKey];
            this.reportProgress(`Checking offering ${offeringKey}...`);
            
            // loop through playout streams, saving first audio stream's keys
            let keyIds;
            for (let streamKey in offering.playout.streams) {
                let stream = offering.playout.streams[streamKey];
                if (stream.representations && Object.entries(stream.representations)[0][1].type === "RepAudio") {
                    if (keyIds) {
                        this.reportProgress(`Setting keys for stream '${streamKey}'...`);
                        stream.encryption_schemes = keyIds;
                        changed++;
                    } else {
                        if (!stream.encryption_schemes || (Object.keys(stream.encryption_schemes).length == 0)) {
                            throw Error(`Audio stream ${streamKey} has no encryption scheme info`);
                        }
                        this.reportProgress(`Using keys from stream '${streamKey}'...`);
                        keyIds = stream.encryption_schemes;
                    }
                }
            }
        }
        if (changed == 0) {
            outputs.mezzanine_object_version_hash = versionHash;
            this.ReportProgress("No changes to make");
            this.releaseMutex();
            return ElvOAction.EXECUTION_FAILED;
        }
        let writeToken = await this.getWriteToken({
            libraryId: libraryId,
            objectId: objectId,
            versionHash,
            client: client
        });
        
        await client.ReplaceMetadata({
            objectId,
            libraryId,
            metadataSubtree: "offerings", 
            writeToken,
            metadata: offerings,
            client
        });
        
        let msg = "Unified audio streams with single set of DRM keys";
        let response = await this.FinalizeContentObject({
            libraryId: libraryId,
            objectId: objectId,
            writeToken: writeToken,
            commitMessage: msg,
            client
        });
        if (response && response.hash) {
            this.ReportProgress(msg)
        } else {
            throw new Error("Failed to save changes to DRM keys");
        }
        outputs.mezzanine_object_version_hash = response.hash;
        this.releaseMutex();
        return ElvOAction.EXECUTION_COMPLETE;        
    };
    

    async executeClipMezzanine({objectId, libraryId, versionHash, client}, outputs) {
        /*
            inputs.offering = {type: "string", required: false, default: "default"};
            inputs.entry_point_sec = {type: "numeric", required: false, default: null};
            inputs.entry_point_rat = {type: "string", required: false, default: null};
            inputs.exit_point_sec = {type: "numeric", required: false, default: null};
            inputs.exit_point_rat = {type: "string", required: false, default: null};
            outputs.mezzanine_object_version_hash = {type: "string"};
        */
        let inputs = this.Payload.inputs;
        await this.acquireMutex(objectId);
        let offering = await this.getMetadata({
            objectId, 
            versionHash, 
            libraryId,
            metadataSubtree: "offerings/"+inputs.offering,
            client
        }); 
        let framerate = offering.media_struct.streams.video.rate;
        let matcher = framerate.match(/^([0-9]+)\/([0-9]+)$/);
        if (!matcher) {
            throw Error("Invalid framerate format '"+ framerate + "'");
        }
        let changed =  false;
        let entryPointRat =  inputs.entry_point_rat;
        if (inputs.entry_point_sec  != null) {
            let frameCount = Math.round(inputs.entry_point_sec * matcher[1] / matcher[2]);
            entryPointRat  = "" + (frameCount * matcher[2]) +"/" + matcher[1];
        } 
        if ((entryPointRat != null) &&  (offering.entry_point_rat != entryPointRat)) {
            offering.entry_point_rat = entryPointRat;
            changed = true;
        }
        let exitPointRat =  inputs.exit_point_rat;
        if (inputs.exit_point_sec  != null) {
            let frameCount = Math.round(inputs.exit_point_sec * matcher[1] / matcher[2]);
            exitPointRat  = "" + (frameCount * matcher[2]) +"/" + matcher[1];
            
        }
        if ((exitPointRat != null) && (offering.exit_point_rat != exitPointRat)) {
            offering.exit_point_rat = exitPointRat;
            changed = true;
        }
        if (!changed) {
            outputs.mezzanine_object_version_hash = versionHash;
            this.ReportProgress("No changes to make");
            this.releaseMutex();
            return ElvOAction.EXECUTION_FAILED;
        }
        let writeToken = await this.getWriteToken({
            libraryId: libraryId,
            objectId: objectId,
            versionHash,
            client: client
        });
        
        await client.ReplaceMetadata({
            objectId,
            libraryId,
            metadataSubtree: "offerings/"+inputs.offering, 
            writeToken,
            metadata: offering,
            client
        });
        
        let msg = "Modified entry and/or exit point";
        let response = await this.FinalizeContentObject({
            libraryId: libraryId,
            objectId: objectId,
            writeToken: writeToken,
            commitMessage: msg,
            client
        });
        if (response && response.hash) {
            this.ReportProgress(msg)
        } else {
            throw new Error("Failed to save changes to entry and/or exit point");
        }
        outputs.mezzanine_object_version_hash = response.hash;
        this.releaseMutex();
        return ElvOAction.EXECUTION_COMPLETE;     
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

    static VERSION = "0.0.4"; 
    static REVISION_HISTORY = {
        "0.0.1": "Initial release",
        "0.0.2": "Adds clipping function to modify entry/exit point of mezzanine",
        "0.0.3": "Fixes support for exit_point_sec in clipping",
        "0.0.4": "Fixes calculation of exit/entry point in rat from sec to make it a multiple of frame duration"
    };
}


if (ElvOAction.executeCommandLine(ElvOActionManageMezzanine)) {
    ElvOAction.Run(ElvOActionManageMezzanine);
} else {
    module.exports=ElvOActionManageMezzanine;
}