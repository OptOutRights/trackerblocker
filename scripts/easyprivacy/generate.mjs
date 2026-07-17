import {
  ARTIFACT_PATH,
  CAPABILITIES_PATH,
  METADATA_PATH,
  buildEasyPrivacyOutputs,
  publishFiles,
  readCommittedInputs,
} from "./lib.mjs";

if (process.argv.length !== 2) {
  throw new Error("generate:easyprivacy does not accept arguments.");
}

const { source, sourceManifest } = await readCommittedInputs();
const outputs = await buildEasyPrivacyOutputs(source, sourceManifest);

await publishFiles([
  [ARTIFACT_PATH, outputs.artifact],
  [METADATA_PATH, outputs.metadataText],
  [CAPABILITIES_PATH, outputs.capabilitiesText],
]);

console.log(
  JSON.stringify(
    {
      sourceSha256: outputs.metadata.sourceSha256,
      artifactSha256: outputs.metadata.artifactSha256,
      artifactBytes: outputs.metadata.artifactBytes,
      packagedNetworkRules: outputs.metadata.ruleCounts.packagedNetworkRules,
    },
    null,
    2,
  ),
);
