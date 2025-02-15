"use strict";

import * as vscode from 'vscode';

import { Project, Group } from "../models";
import { ADD_NEW_PROJECT_TO_FRONT, PROJECTS_KEY } from "../constants";
import BaseService from './baseService';
import ColorService from './colorService';
import * as path from "path";
import * as fs from "fs";

export default class ProjectService extends BaseService {

    colorService: ColorService;

    constructor(context: vscode.ExtensionContext, colorService: ColorService) {
        super(context);
        this.colorService = colorService;
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ GET ~~~~~~~~~~~~~~~~~~~~~~~~~
    getGroups(noSanitize = false): Group[] {
        var groups = this.useSettingsStorage() ?
            this.getProjectsFromSettings() :
            this.getProjectsFromGlobalState();

        if (!noSanitize) {
            groups = this.sanitizeGroups(groups);
        }

        return groups;
    }

    getGroup(groupId: string): Group {
        var groups = this.getGroups();
        return groups.find(g => g.id === groupId) || null;
    }

    getProjectsFlat(): Project[] {
        var groups = this.getGroups();
        var projects = [];
        for (let group of groups) {
            projects.push.apply(projects, group.projects);
        }

        return projects;
    }

    getProject(projectId: string): Project {
        var [project] = this.getProjectAndGroup(projectId);
        return project;
    }

    getProjectAndGroup(projectId: string): [Project, Group] {
        if (projectId == null) {
            return null;
        }

        var groups = this.getGroups();
        for (let group of groups) {
            let project = group.projects.find(p => p.id === projectId);
            if (project != null) {
                return [project, group];
            }
        }
        return [null, null];
    }

    async getProjectScripts(projectId: string, projectFolder?: string): Promise<string[]> {
        const project = this.getProject(projectId);
        let root = project.path;
        if (projectFolder) {
            //project is a workspace file
            const dirOfWorkspaceFile = path.dirname(project.path)
            root = path.join(dirOfWorkspaceFile, projectFolder);
        }

        return await vscode.workspace.openTextDocument(path.join(root, "package.json")).then((document) => {
            const packageJson = JSON.parse(document.getText());
            const scripts = packageJson.scripts;
            return Object.keys(scripts);
        });

    }

    async getWorkspaceFolders(projectId: string): Promise<string[]> {
        const project = this.getProject(projectId);
        const isWorkspaceFile = !fs.statSync(project.path).isDirectory();
        console.log("isWorkspaceFile ", isWorkspaceFile);
        console.log("reading ", path.join(project.path, "package.json"))
        if (isWorkspaceFile) {
            const content = fs.readFileSync(project.path).toString();
            const json = JSON.parse(content);
            return json.folders.map(f => f.path);
        }
        throw new Error("Not a workspace file: " + project.path);
    }
    // ~~~~~~~~~~~~~~~~~~~~~~~~~ ADD ~~~~~~~~~~~~~~~~~~~~~~~~~
    async addGroup(groupName: string, projects: Project[] = null): Promise<Group> {
        var groups = this.getGroups();
        if (groups == null) {
            groups = [];
        }

        let newGroup = new Group(groupName, projects);
        groups.push(newGroup);
        await this.saveGroups(groups);
        return newGroup;
    }

    async addProject(project: Project, groupId: string): Promise<Group[]> {
        // Get groups, default them to [] if there are no groups
        var groups = this.getGroups(true);
        if (groups == null) {
            groups = [];
        }

        // Get the group if there is any
        var group = groups.find(g => g.id === groupId);

        if (group == null) {
            if (groups.length) {
                // No group found, but there are groups? Default to first group
                group = groups[0];
            } else {
                // No groups, create initial group
                group = new Group(null);
                groups.push(group);
            }
        }

        if (ADD_NEW_PROJECT_TO_FRONT) {
            group.projects.unshift(project);
        } else {
            group.projects.push(project);
        }

        // Add to recent colors
        try {
            await this.colorService.addRecentColor(project.color);
        } catch (e) {
            console.error(e);
        }

        await this.saveGroups(groups);
        return groups;
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ UPDATE ~~~~~~~~~~~~~~~~~~~~~~~~~
    async updateProject(projectId: string, updatedProject: Project) {
        if (!projectId || updatedProject == null) {
            return;
        }

        var groups = this.getGroups();
        for (let group of groups) {
            let project = group.projects.find(p => p.id === projectId);
            if (project != null) {
                Object.assign(project, updatedProject, { id: projectId });
                break;
            }
        }


        // Add to recent colors
        try {
            await this.colorService.addRecentColor(updatedProject.color);
        } catch (e) {
            console.error(e);
        }
        await this.saveGroups(groups);
    }

    async updateGroup(groupId: string, updatedGroup: Group) {
        if (!groupId || updatedGroup == null) {
            return;
        }

        var groups = this.getGroups();
        var group = groups.find(g => g.id === groupId);
        if (group != null) {
            Object.assign(group, updatedGroup, { id: groupId });
        }

        await this.saveGroups(groups);
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ REMOVE ~~~~~~~~~~~~~~~~~~~~~~~~~
    async removeProject(projectId: string): Promise<Group[]> {
        let groups = this.getGroups();
        for (let i = 0;i < groups.length;i++) {
            let group = groups[i];
            let index = group.projects.findIndex(p => p.id === projectId);

            if (index !== -1) {
                group.projects.splice(index, 1);
                break;
            }
        }
        await this.saveGroups(groups);
        return groups;
    }

    async removeGroup(groupId: string, testIfEmpty: boolean = false): Promise<Group[]> {
        let groups = this.getGroups();

        groups = groups.filter(g => g.id !== groupId || (testIfEmpty && g.projects.length));
        await this.saveGroups(groups);

        return groups;
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ SAVE ~~~~~~~~~~~~~~~~~~~~~~~~~
    saveGroups(groups: Group[]): Thenable<void> {
        groups = this.sanitizeGroups(groups);

        return this.useSettingsStorage() ?
            this.saveGroupsInSettings(groups) :
            this.saveGroupsInGlobalState(groups);
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ STORAGE ~~~~~~~~~~~~~~~~~~~~~~~~~
    private getProjectsFromGlobalState(unsafe: boolean = false): Group[] {
        var groups = this.context.globalState.get(PROJECTS_KEY) as Group[];

        if (groups == null && !unsafe) {
            groups = [];
        }

        return groups;
    }

    private getProjectsFromSettings(unsafe: boolean = false): Group[] {
        var groups = this.configurationSection.get('projectData') as Group[];

        if (groups == null && !unsafe) {
            groups = [];
        }

        return groups;
    }

    private saveGroupsInGlobalState(groups: Group[]): Thenable<void> {
        return this.context.globalState.update(PROJECTS_KEY, groups);
    }

    private saveGroupsInSettings(groups: Group[]): Thenable<void> {
        return this.configurationSection.update("projectData", groups, vscode.ConfigurationTarget.Global);
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ MODEL MIGRATION ~~~~~~~~~~~~~~~~~~~~~~~~~
    async migrateDataIfNeeded() {
        var toMigrate = false;

        var projectsInSettings = this.getProjectsFromSettings(true);
        var projectsInGlobalState = this.getProjectsFromGlobalState(true);

        if (this.useSettingsStorage()) {
            // Migrate from Global State to Settings
            toMigrate = projectsInSettings == null && projectsInGlobalState != null;

            if (toMigrate) {
                await this.saveGroupsInSettings(projectsInGlobalState);
            }

            await this.saveGroupsInGlobalState(null);
        } else {
            // Migrate from Settings To Global State
            toMigrate = projectsInGlobalState == null && projectsInSettings != null;

            if (toMigrate) {
                await this.saveGroupsInGlobalState(projectsInSettings);
            }

            await this.saveGroupsInSettings(null);
        }

        return toMigrate;
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~ HELPERS ~~~~~~~~~~~~~~~~~~~~~~~~~

    private sanitizeGroups(groups: Group[]): Group[] {
        groups = Array.isArray(groups) ? groups.filter(g => !!g) : [];

        // Fill id, should only happen if user removes id manually. But better be safe than sorry.
        for (let g of groups) {
            if (!g.id) {
                g.id = Group.getRandomId();
            }
        }

        return groups;
    }
}