#!/usr/bin/env node
import { compareVersions } from "compare-versions";
import { find, bedrockSchema } from "./find";
import { extendFs, httpRequestLarge } from "@the-bds-maneger/core-utils";
import { getOctokit } from "@actions/github";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
const allPath = path.join(__dirname, "../versions/all.json");

const secret = process.env.GITHUB_SECRET||process.env.GITHUB_TOKEN;
async function createRelease(options: {tagName: string, secret?: string, prerelease?: boolean}) {
  options = {secret, prerelease: false, ...options};
  const octokit = getOctokit(secret);
  const releases = (await octokit.rest.repos.listReleases({owner: "The-Bds-Maneger", repo: "BedrockFetch"})).data;
  let release = releases.find(release => release.tag_name === options.tagName);
  if (!release) {
    console.info("Creating relase!");
    release = (await octokit.rest.repos.createRelease({owner: "The-Bds-Maneger", repo: "BedrockFetch", tag_name: options.tagName, prerelease: options.prerelease||false})).data;
  }
  async function uploadFile(filePath: string, name: string = path.basename(filePath)) {
    const fileExists = (await octokit.rest.repos.listReleaseAssets({release_id: release.id, owner: "The-Bds-Maneger", repo: "BedrockFetch"})).data.find(file => file.name === name);
    if (fileExists) {
      console.info("Deleting %s", name);
      await octokit.rest.repos.deleteReleaseAsset({
        owner: "The-Bds-Maneger",
        repo: "BedrockFetch",
        asset_id: fileExists.id
      });
    }
    console.log("Uploding %s", name);
    const fileInfo = await fs.lstat(filePath);
    const { data } = await octokit.rest.repos.uploadReleaseAsset({
      release_id: release.id,
      owner: "The-Bds-Maneger",
      repo: "BedrockFetch",
      name: name,
      data: createReadStream(filePath) as any as string,
      headers: {"content-length": fileInfo.size},
      mediaType: {
        format: "application/octet-stream"
      },
    });
    console.log("File %s, download url: '%s'", name, data.browser_download_url);
    return data;
  }
  return {release, uploadFile};
}

main().then(console.log);
async function main() {
  const all: bedrockSchema[] = JSON.parse(await fs.readFile(allPath, "utf8"));
  const findData = await find();
  for (const data of findData) {
    // Add to all
    if (!all.some(version => version.version === data.version)) {
      // Write env
      if (process.env.GITHUB_ENV) {
        const githubEnv = path.resolve(process.env.GITHUB_ENV);
        await fs.writeFile(githubEnv, `VERSION=${data.version}\nUPLOAD=true`);
        // 'downloadFiles' path
        const onSave = path.resolve(__dirname, "../downloadFiles");
        if (!await extendFs.exists(onSave)) await fs.mkdir(onSave, {recursive: true});
        const rel = await createRelease({tagName: data.version, prerelease: data.release === "preview"});
        for (const platform of Object.keys(data.url)) {
          for (const keyName of Object.keys(data.url[platform])) {
            const downloadData = {url: data.url[platform][keyName], name: `${platform}_${keyName}_${path.basename((new URL(data.url[platform][keyName])).pathname)}`};
            const filePath = await httpRequestLarge.saveFile({url: downloadData.url, filePath: path.join(onSave, downloadData.name)});
            data.url[platform][keyName] = (await rel.uploadFile(filePath)).browser_download_url;
          }
        }
      }
      all.push(data);
    }
    const filePath = path.join(__dirname, "../versions", `${data.version}.json`);
    if (!await extendFs.exists(filePath)) await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }
  await fs.writeFile(allPath, JSON.stringify(all.sort((a, b) => compareVersions(a.version, b.version)), null, 2));
  return findData;
}
