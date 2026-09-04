
const ElvOAction = require("../o-action").ElvOAction;
//const { execSync } = require('child_process');
const ElvOFabricClient = require("../o-fabric");
const ElvOMutex = require("../o-mutex");

class ElvOActionManageProductionMaster extends ElvOAction  {
    
    ActionId() {
        return "manage_production_master";
    };
    
    Parameters() {
        return {
            parameters: {
                aws_s3: {type: "boolean"},
                action: {type: "string", required: true, values:["MASTER_INIT", "PROBE_SOURCES", "CREATE"]}
            }
        };
    };
    
    PollingInterval() {
        return 60; //poll every minutes
    };
    
    IOs(parameters) {
        let inputs = {
            production_master_object_id: {type: "string", required:true},
            private_key: {type: "password", required:false},
            config_url: {type: "string", required:false},
            safe_update: {type: "boolean", required: false, default: false}
        };
        if (parameters.aws_s3) {
            inputs.cloud_access_key_id = {type: "string", required:false};
            inputs.cloud_secret_access_key = {type: "password", required:false};
            inputs.cloud_crendentials_path = {type: "file", required:false};
            inputs.cloud_bucket = {type: "string", required:false};
            inputs.cloud_region = {type: "file", required:false};
        }
        let outputs = {
            production_master_object_version_hash: "string"
        };
        if  (parameters.action  == "PROBE_SOURCES") {
            inputs.files_to_probe = {type: "array", required:true}
            outputs.files_probe = "object";
            outputs.probe_errors = "array";
            outputs.probe_warnings = "array";
            outputs.probe_logs = "array";
        }
        return {inputs: inputs, outputs: outputs}
    };
    
    async Execute(handle, outputs) {
        let client;
        if (!this.Payload.inputs.private_key && !this.Payload.inputs.config_url) {
            client = this.Client;
        } else {
            let privateKey = this.Payload.inputs.private_key || this.Client.signer.signingKey.privateKey.toString();
            let configUrl = this.Payload.inputs.config_url || this.Client.configUrl;
            client = await ElvOFabricClient.InitializeClient(configUrl, privateKey)
        }
        
        let objectId = this.Payload.inputs.production_master_object_id;
        let libraryId = await this.getLibraryId(objectId, client);
        
        if (this.Payload.parameters.action == "MASTER_INIT") {
            return await this.executeMastetInit({client, objectId, libraryId}, outputs);
        }
        if (this.Payload.parameters.action == "PROBE_SOURCES") {
            return await this.executeProbeSources({client, objectId, libraryId}, outputs);
        }
        throw Error("Action not supported: "+this.Payload.parameters.action);
    };
    
    
    async executeMastetInit({client, objectId, libraryId}, outputs) {
        try {
            let access;
            if (this.Payload.parameters.aws_s3) {
                let cloud_access_key_id = this.Payload.inputs.cloud_access_key_id;
                let cloud_secret_access_key = this.Payload.inputs.cloud_secret_access_key;
                let cloud_region = this.Payload.inputs.cloud_region;
                let cloud_bucket = this.Payload.inputs.cloud_bucket;
                let cloud_crendentials_path = this.Payload.inputs.cloud_crendentials_path;
                if (cloud_crendentials_path) {
                    access = JSON.parse(fs.readFileSync(cloud_crendentials_path));
                } else {
                    if (!cloud_region || !cloud_bucket || !cloud_access_key_id || !cloud_secret_access_key) {
                        this.ReportProgress("ERROR - Missing required S3 environment variables: cloud_region, cloud_bucket, cloud_secret_access_key");
                        return -1
                    }
                    access = [
                        {
                            path_matchers: [".*"],
                            remote_access: {
                                protocol: "s3",
                                platform: "aws",
                                path: cloud_bucket + "/",
                                storage_endpoint: {
                                    region: cloud_region
                                },
                                cloud_credentials: {
                                    access_key_id: cloud_access_key_id,
                                    secret_access_key: cloud_secret_access_key
                                }
                            }
                        }
                    ];
                }
            }
            
            this.ReportProgress("Initialize production master metadata for object " + objectId);
            
            let reporter = this;
            ElvOAction.TrackerPath = this.TrackerPath;
            client.ToggleLogging(true, {log: reporter.Debug, error: reporter.Error});
            
            await this.acquireMutex(objectId);
            
            let writeToken = await this.getWriteToken({
                libraryId: libraryId,
                objectId: objectId,
                client
            });
            
            const {data, errors, warnings, logs} = await client.CallBitcodeMethod({
                objectId,
                libraryId,
                method: "/media/production_master/init",
                writeToken,
                body: {access},
                constant: false
            });
            if (logs) {
                for (let i = 0; i < logs.length; i++) {
                    this.ReportProgress(logs[i]);
                }
            }
            if (warnings) {
                for (let i = 0; i < warnings.length; i++) {
                    this.ReportProgress("Bit code warning", warnings[i]);
                }
            }
            if (errors) {
                for (let i = 0; i < errors.length; i++) {
                    this.ReportProgress("Bit code error", errors[i]);
                    this.Error("Bit code error", errors[i])
                }
                throw Error("Bit code error");
            }
            
            let response = await this.FinalizeContentObject({
                libraryId: libraryId,
                objectId: objectId,
                writeToken: writeToken,
                commitMessage: "Initialized production master metadata",
                client
            });
            outputs.production_master_object_version_hash = response.hash;            
            this.releaseMutex();
            this.ReportProgress("Initialized production master metadata");
            return ElvOAction.EXECUTION_COMPLETE;
        } catch(err) {
            this.releaseMutex();
            this.Error("Could not initiliaze production master", err);
            return ElvOAction.EXECUTION_EXCEPTION;
        }
    };
    
    
    async executeProbeSources({client, objectId, libraryId}, outputs) {
        try {
            let access;
            if (this.Payload.parameters.aws_s3) {
                let cloud_access_key_id = this.Payload.inputs.cloud_access_key_id;
                let cloud_secret_access_key = this.Payload.inputs.cloud_secret_access_key;
                let cloud_region = this.Payload.inputs.cloud_region;
                let cloud_bucket = this.Payload.inputs.cloud_bucket;
                let cloud_crendentials_path = this.Payload.inputs.cloud_crendentials_path;
                if (cloud_crendentials_path) {
                    access = JSON.parse(fs.readFileSync(cloud_crendentials_path));
                } else {
                    if (!cloud_region || !cloud_bucket || !cloud_access_key_id || !cloud_secret_access_key) {
                        this.ReportProgress("ERROR - Missing required S3 environment variables: cloud_region, cloud_bucket, cloud_secret_access_key");
                        return -1
                    }
                    access = [
                        {
                            path_matchers: [".*"],
                            remote_access: {
                                protocol: "s3",
                                platform: "aws",
                                path: cloud_bucket + "/",
                                storage_endpoint: {
                                    region: cloud_region
                                },
                                cloud_credentials: {
                                    access_key_id: cloud_access_key_id,
                                    secret_access_key: cloud_secret_access_key
                                }
                            }
                        }
                    ];
                }
            }
            
            let body = {file_paths: this.Payload.inputs.files_to_probe, access};

            let reporter = this;
            ElvOAction.TrackerPath = this.TrackerPath;
            client.ToggleLogging(true, {log: reporter.Debug, error: reporter.Error});

            let result = await client.CallBitcodeMethod({
                //versionHash: contentHash,
                objectId,
                libraryId,
                method: "/media/files/probe",
                constant: false,
                body: body
            });
            outputs.files_probe = result.data;
            outputs.probe_errors = result.errors;
            outputs.probe_warnings = result.warnings;
            outputs.probe_logs= result.logs
            if (result.errors && result.errors.length > 0) {
                this.Error("errors", result.errors);
                throw Error("Errors encountered during probing");
            }

            await this.acquireMutex(objectId);
            
            let writeToken = await this.getWriteToken({
                libraryId: libraryId,
                objectId: objectId,
                client
            });
            for  (let file of this.Payload.inputs.files_to_probe) {
                await  client.ReplaceMetadata({
                    libraryId: libraryId,
                    objectId: objectId,
                    metadataSubtree: "production_master/sources/"+file,
                    metadata: outputs.files_probe[file],
                    writeToken, 
                    client
                });
            }
            
            let response = await this.FinalizeContentObject({
                libraryId: libraryId,
                objectId: objectId,
                writeToken: writeToken,
                commitMessage: "Probed " + this.Payload.inputs.files_to_probe.length + " sources",
                client
            });
            outputs.production_master_object_version_hash = response.hash;            
            this.releaseMutex();
            this.ReportProgress("Saved probed sources data");
            return ElvOAction.EXECUTION_COMPLETE;
        } catch(err) {
            this.releaseMutex();
            this.Error("Could not probe production master sources", err);
            return ElvOAction.EXECUTION_EXCEPTION;
        }
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
    
    
    static VERSION = "0.0.2";
    static REVISION_HISTORY = {
        "0.0.1": "Initial release",
        "0.0.2": "Allows encrypted value for cloud secret"
    };
}


if (ElvOAction.executeCommandLine(ElvOActionManageProductionMaster)) {
    ElvOAction.Run(ElvOActionManageProductionMaster);
} else {
    module.exports=ElvOActionManageProductionMaster;
}
