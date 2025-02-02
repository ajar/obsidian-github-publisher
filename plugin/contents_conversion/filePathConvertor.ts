import {MetadataCache, TFile, Vault, TFolder, FrontMatterCache} from "obsidian";
import {folderSettings, LinkedNotes, GitHubPublisherSettings, frontmatterConvert} from "../settings/interface";
import {getFrontmatterCondition} from "../src/utils";

function getDataviewPath(
	markdown: string,
	settings: GitHubPublisherSettings,
	vault: Vault):LinkedNotes[] {
	if (!settings.convertDataview) {
		return [];
	}
	const wikiRegex = /\[\[(.*?)\]\]/gmi;
	const wikiMatches = markdown.matchAll(wikiRegex);
	const linkedFiles:LinkedNotes[] = [];
	if (!wikiMatches) return [];
	if (wikiMatches) {
		for (const wikiMatch of wikiMatches) {
			const altText = wikiMatch[1].replace(/(.*)\\?\|/i, '');
			const linkFrom = wikiMatch[1].replace(/\\?\|(.*)/, '');
			const linked = vault.getAbstractFileByPath(linkFrom) instanceof TFile ? vault.getAbstractFileByPath(linkFrom) as TFile: null;
			if (linked) {
				linkedFiles.push({
					linked: linked,
					linkFrom: linkFrom,
					altText: altText
				})
			}
		}
	}
	return linkedFiles;
}

function createRelativePath(
	sourceFile: TFile,
	targetFile: LinkedNotes,
	metadata: MetadataCache,
	settings: GitHubPublisherSettings,
	vault: Vault,
	frontmatter: FrontMatterCache | null):string {
	/**
	 * Create relative path from a sourceFile to a targetPath. If the target file is a note, only share if the frontmatter sharekey is present and true
	 * @param sourceFile: TFile, the shared file containing all links, embed etc
	 * @param targetFile: {linked: TFile, linkFrom: string, altText: string}
	 * @param settings: GitHubPublisherSettings
	 * @param metadata: metadataCache
	 * @return string : relative created path
	 */
	const sourcePath = getReceiptFolder(sourceFile, settings, metadata, vault);
	if (
		targetFile.linked.extension === 'md'
		&& (
			!frontmatter
			|| !frontmatter[settings.shareKey]
			|| (frontmatter[settings.shareKey] === false))) {
		return targetFile.altText;
	}
	if (targetFile.linked.path === sourceFile.path) {
		return getReceiptFolder(targetFile.linked, settings, metadata, vault).split('/').at(-1);
	}

	const targetPath = targetFile.linked.extension === 'md' ? getReceiptFolder(targetFile.linked, settings, metadata, vault) : getImageLinkOptions(targetFile.linked, settings, getFrontmatterCondition(frontmatter, settings));
	const sourceList = sourcePath.split('/');
	const targetList = targetPath.split('/');

	const excludeUtilDiff = (sourceList: string[], targetList: string[]): string[] => {
		let i = 0;
		while (sourceList[i] === targetList[i]) {
			i++;
		}
		return sourceList.slice(i);
	}

	const diffSourcePath = excludeUtilDiff(sourceList, targetList);
	const diffTargetPath = excludeUtilDiff(targetList, sourceList);
	const diffTarget = function (folderPath: string[]) {
		const relativePath = [];
		for (const folder of folderPath) {
			if (folder != folderPath.at(-1)) {
				relativePath.push('..');
			}
		}

		return relativePath;
	};
	const relativePath = diffTarget(diffSourcePath);
	if (relativePath.length === 0) {
		relativePath.push('.')
	}
	let relative = relativePath.concat(diffTargetPath).join('/')
	if (relative.trim() === '.' || relative.trim() === '') { //in case of errors
		relative = getReceiptFolder(targetFile.linked, settings, metadata, vault).split('/').at(-1);
	}
	console.log(sourceList, targetList, relativePath, diffSourcePath, diffTargetPath, relative);
	return relative;
}

function folderNoteIndexOBS(
	file: TFile,
	vault: Vault,
	settings: GitHubPublisherSettings): string
{
	if (!settings.folderNote) return file.name;
	const fileName = file.name.replace('.md', '');
	const folderParent = file.parent.name;
	if (fileName === folderParent) return 'index.md';
	const outsideFolder = vault.getAbstractFileByPath(file.path.replace('.md', ''));
	if (outsideFolder && outsideFolder instanceof TFolder) return 'index.md'
	return file.name;
}

function createObsidianPath(
	file: TFile,
	settings:GitHubPublisherSettings,
	vault: Vault,
	fileName: string): string {
	/**
	 * Create link path based on settings and file path
	 * @param file : TFile - Image TFile
	 * @param settings : GitHubPublisherSettings - Settings
	 * @returns string - Link path
	 */

	const folderDefault = settings.folderDefaultName;
	fileName = folderNoteIndexOBS(file, vault, settings);

	const rootFolder = folderDefault.length > 0 ? folderDefault + "/" : ''
	const path = rootFolder + file.path.replace(file.name, fileName);
	if (settings.subFolder.length > 0) {
		return path.replace(settings.subFolder + '/', '');
	}
	return path;
}

function folderNoteIndexYAML(fileName: string, frontmatter: FrontMatterCache, settings: GitHubPublisherSettings):string {
	const category = frontmatter[settings.yamlFolderKey]
	const parentCatFolder = !category.endsWith('/') ? category.split('/').at(-1): category.split('/').at(-2);
	if (!settings.folderNote) return fileName;
	if (fileName.replace('.md', '').toLowerCase() === parentCatFolder.toLowerCase()) return 'index.md';
	return fileName;
}

function createFrontmatterPath(
	file: TFile,
	settings: GitHubPublisherSettings,
	frontmatter: FrontMatterCache,
	fileName: string): string {
	let path = settings.folderDefaultName.length > 0 ? settings.folderDefaultName + "/" + fileName : fileName;
	let folderRoot = settings.rootFolder;
	if (folderRoot.length > 0) {
		folderRoot = folderRoot + "/";
	}
	if (frontmatter && frontmatter[settings.yamlFolderKey]) {
		path = folderRoot + frontmatter[settings.yamlFolderKey] + "/" + folderNoteIndexYAML(fileName, frontmatter, settings);
	}
	return path
}

function getTitleField(frontmatter: FrontMatterCache, file: TFile, settings: GitHubPublisherSettings): string {
	if (!settings.useFrontmatterTitle || !frontmatter) {
		return file.name;
	} else if (frontmatter && frontmatter[settings.frontmatterTitleKey] && frontmatter[settings.frontmatterTitleKey] !== file.name) {
		return frontmatter[settings.frontmatterTitleKey] + '.md';
	}
	return file.name;
}

function getReceiptFolder(
	file: TFile,
	settings:GitHubPublisherSettings,
	metadataCache: MetadataCache,
	vault: Vault): string {
	if (file.extension === 'md') {
		const frontmatter = metadataCache.getCache(file.path)?.frontmatter

		const fileName = getTitleField(frontmatter, file, settings)
		if (!frontmatter[settings.shareKey]) {
			return fileName;
		}

		let path = settings.folderDefaultName.length > 0 ? settings.folderDefaultName + "/" + fileName : fileName;
		
		if (settings.downloadedFolder === folderSettings.yaml) {
			path = createFrontmatterPath(file, settings, frontmatter, fileName);
		} else if (settings.downloadedFolder === folderSettings.obsidian) {
			path = createObsidianPath(file, settings, vault, fileName);
		}
		return path
	}
}

function getImageLinkOptions(file: TFile, settings: GitHubPublisherSettings, sourceFrontmatter: frontmatterConvert | null):string {
	/**
	 * Create link path based on settings and file path
	 * @param file : TFile - Image TFile
	 * @param settings : GitHubPublisherSettings - Settings
	 * @returns string - Link path
	 */
	if (!sourceFrontmatter) {
		if (settings.defaultImageFolder.length > 0) {
			return settings.defaultImageFolder + "/" + file.name;
		} else if (settings.folderDefaultName.length > 0) {
			return settings.folderDefaultName + "/" + file.name;
		} else {
			return file.path;
		}
	}
	else if (sourceFrontmatter && sourceFrontmatter.attachmentLinks !== undefined) {
		return sourceFrontmatter.attachmentLinks + "/" + file.name;
	}
	return file.path;
}

export {
	getReceiptFolder,
	getImageLinkOptions,
	createRelativePath,
	getDataviewPath
}
