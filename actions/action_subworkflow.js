const ElvOAction = require("../o-action").ElvOAction;
const ElvOJob = require("../o-job.js");
const ElvOQueue = require("../o-queue");
const { execSync } = require('child_process');
const fs = require("fs");


class ElvOActionSubworkflow extends ElvOAction  {

    ActionId() {
        return "subworkflow";
    };

    IsContinuous() {
        return false; //indicates that the execution stays within a single PID
    };

    Parameters() {
        return {"parameters": {
                "workflow_id": {type: "string", required: true}
            }
        };
    };

    IOs(parameters) {
        let io = this.retrieveIOs();
        if  (!io) {
            //let workflowDefinition = await this.getMetadata({objectId: parameters.workflow_id, metadataSubtree: "workflow_definition"});
            io =  JSON.parse(execSync("node o.js workflow-io --workflow-id="+parameters.workflow_id, {maxBuffer: 100 * 1024 * 1024}).toString());
            io.inputs.queue_id = {type: "string", required: false, default: "system"};
            io.inputs.priority = {type: "numeric", required: false, default: 100};
            this.markIOs(io);
        }
        return io;
    };


    PollingInterval() {
        return 60; //poll every minutes
    };

    async Execute(handle, outputs) {
        let queueId = this.Payload.inputs.queue_id;
        let priority = this.Payload.inputs.priority || 100;
        let parentJobId = this.Payload.references && this.Payload.references.job_id;
        let itemId = "subworkflow__" + parentJobId +(new Date()).getTime();
        this.markSubworkflowRef(itemId);
        /*let jobDescription = await this.getMetadata({
            objectId: this.Payload.parameters.workflow_id,
            metadataSubtree: "workflow_definition"
        });
        jobDescription.id = itemId;
        */
        let jobDescription = {
            id: itemId,
            workflow_object_id: this.Payload.parameters.workflow_object_id,
            workflow_id: this.Payload.parameters.workflow_id,
            parameters: this.Payload.inputs
        };
        if  (queueId == "system") {
            ElvOQueue.Create("system", 100, true,  "Default system queues used for sub-workflows", true);
        }
        let pathInQueue = ElvOQueue.Queue(queueId, jobDescription, priority);

        if (pathInQueue) {
            this.markQueued(pathInQueue);
            return ElvOAction.EXECUTION_ONGOING;
        } else {
            this.ReportProgress("Failed to queue sub-workflow job");
            return ElvOAction.EXECUTION_EXCEPTION;
        }
    };


    async MonitorExecution(pid, outputs) {
        if (ElvOAction.PidRunning(pid)) {
            return ElvOAction.EXECUTION_ONGOING;
        }
        let subworkflowRef = this.retrieveSubworkflowRef();
        if (!subworkflowRef) { //if not marked yet, pid should still be running
            this.ReportProgress("Failed to retrieve sub-workflow reference");
            return ElvOAction.EXECUTION_EXCEPTION;
        }
        let jobData = ElvOJob.GetJobInfoSync({jobRef: subworkflowRef});
        if (!jobData) {
            let pathInQueue = this.retrieveQueuedRef();
            if (fs.existsSync(pathInQueue)) {
                this.ReportProgress("Job queued");
                return ElvOAction.EXECUTION_ONGOING;
            } else {
                await this.sleep(1000); //in case object was removed from list but job not created yet
                jobData = ElvOJob.GetJobInfoSync({jobRef: subworkflowRef});
                if (!jobData) {
                    this.ReportProgress("Job not found queued or in execution");
                    return ElvOAction.EXECUTION_EXCEPTION;
                }
            }
        }

        let stepsExecuted = jobData.workflow_execution.steps || {};
        let jobId = jobData.workflow_execution.job_id;
        this.ReportProgress('Subworkflow ' + jobId + " - " + jobData.workflow_execution.status_code, Object.keys(stepsExecuted));
        for (let stepExecuted in stepsExecuted) {
            outputs[stepExecuted] = stepsExecuted[stepExecuted].outputs;
        }
        if (jobData.workflow_execution.status_code == 100) {
            return ElvOAction.EXECUTION_COMPLETE;
        }
        if (jobData.workflow_execution.status_code == 99) {
            return ElvOAction.EXECUTION_FAILED;
        }
        if (jobData.workflow_execution.status_code == -1) {
            return ElvOAction.EXECUTION_EXCEPTION;
        }
        return ElvOAction.EXECUTION_ONGOING;
    };



    markSubworkflowRef(subworkflowRef) {
        this.trackProgress(ElvOActionSubworkflow.TRACKER_REF, "Sub-workflow reference", subworkflowRef);
    };

    retrieveSubworkflowRef() {
        let info = this.Tracker && this.Tracker[ElvOActionSubworkflow.TRACKER_REF];
        return info && info.details;
    };

    markQueued(pathInQueue) {
        this.trackProgress(ElvOActionSubworkflow.QUEUED_REF, "Queued sub-workflow", pathInQueue);
    };

    retrieveQueuedRef() {
        let info = this.Tracker && this.Tracker[ElvOActionSubworkflow.QUEUED_REF];
        return info && info.details;
    };

    markIOs(io) {
        this.trackProgress(ElvOActionSubworkflow.TRACKER_IO, "IO", io);
    };

    retrieveIOs() {
        let info = this.Tracker && this.Tracker[ElvOActionSubworkflow.TRACKER_IO];
        return info && info.details;
    };

    static TRACKER_REF = 63;
    static TRACKER_IO = 64;
    static QUEUED_REF = 66;


    static VERSION = "0.0.6";
    static REVISION_HISTORY = {
        "0.0.1": "Initial release",
        "0.0.2": "Avoids getting permanently stuck on launch failure",
        "0.0.3": "Adds dynamic generation of system queue",
        "0.0.4": "Adds parent job_id to reference",
        "0.0.5": "Caches IOs to avoid making extra API call on each poll",
        "0.0.6": "Reports on queued jobs"
    };
}


if (ElvOAction.executeCommandLine(ElvOActionSubworkflow)) {
    ElvOAction.Run(ElvOActionSubworkflow);
} else {
    module.exports=ElvOActionSubworkflow;
}
