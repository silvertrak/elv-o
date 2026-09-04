const ElvOAction = require("../o-action").ElvOAction;
//const ElvOFabricClient = require("../o-fabric");
const fetch = require('node-fetch');

class ElvOActionSlack extends ElvOAction  {

  ActionId() {
    return "slack";
  };

  Parameters() {
    return {
      "parameters": {
        is_slack_webhook: {type: "boolean", required: false, default: true},
        text: {type: "string", required: false, default: "%%\"%text%\"%%"},
        blocks: {type: "string", required: false, default: null},
        variables: {
          type: "object", required: false, default: {text: {type: "string", required: false, default: "-"}}
        },
        headers: {type: "array", required: false, default:[]}
      }
    }
  };

  IOs(parameters) {
    let inputs =  parameters.variables || {}; //all variables are to be explicitly defined for now
    if (parameters.headers) {
      for (let header of parameters.headers) {
        inputs[header] = {type: "string", required: true};
      }
    }
    inputs.web_hook = {type: "password", required:true};
    let outputs =  {text: {type:"string"}, blocks:  {type:"string"}, result:{type:"string"}};
    return {inputs: inputs, outputs: outputs}
  };


  async Execute(handle, outputs) {
    let inputs = this.Payload.inputs;
    let text = this.Payload.parameters.text;
    let blocks = this.Payload.parameters.blocks;
    this.ReportProgress("Submitting message to web-hook");
    let headers = null;
    if (this.Payload.parameters.headers && this.Payload.parameters.headers.length != 0) {
      headers = {};
      for (let header of this.Payload.parameters.headers) {
        headers[header] = inputs[header];
      }
    }
    let rawResult = await fetch(inputs.web_hook, {
      method: "POST",
      body: JSON.stringify({text, blocks}),
      headers
    });
    let result = await rawResult.text();
    outputs.result = result;
    this.ReportProgress("Response received from web-hook call", result);
    if  (this.Payload.parameters.is_slack_webhook && result != "ok") {
      this.Error("Unexpected response, 'ok' was expected ", result);
      this.ReportProgress("Unexpected response, 'ok' was expected");
      return ElvOAction.EXECUTION_ERROR;
    } else {
      outputs.text = text;
      outputs.blocks = blocks;
      return ElvOAction.EXECUTION_COMPLETE;
    }

  };



  static VERSION = "0.0.2";
  static REVISION_HISTORY = {
    "0.0.1": "Initial release",
    "0.0.2": "Adds ability to set custom headers"
  };

}

if (ElvOAction.executeCommandLine(ElvOActionSlack)) {
  ElvOAction.Run(ElvOActionSlack);
} else {
  module.exports=ElvOActionSlack;
}
