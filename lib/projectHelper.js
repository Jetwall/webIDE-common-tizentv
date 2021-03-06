const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const archiver = require('archiver');
const { exec } = require('child_process');

const PackageSigner = require('./packageSigner');
const profileEditor = require('./profileEditor');
const AppLauncher = require('./appLauncher').AppLauncher;

module.exports = class TVWebApp {
    constructor(name, location, id) {
        this.name = name;
        this.location = location;
        this.id = id === undefined ? this._generateID(10) : id;
    }

    get appID() { return this.id; }
    get appName() { return this.name; }
    get appLocation() { return this.location; }

    _generateID(length) {
        let res = '';
        let idChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N',
            'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b',
            'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
            'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

        for (let i = 0; i < length; i++) {
            res += idChars[Math.round(Math.random() * 61)];
        }
        return res;
    }

    _cleanFiles(rmWgt) {
        if (rmWgt) {
            let widgetFile = path.resolve(this.location, `${this.name}.wgt`);
            if (fs.existsSync(widgetFile)) {
                fs.unlinkSync(widgetFile)
            }
        }

        let authorSigFile = path.resolve(this.location, `author-signature.xml`);
        if (fs.existsSync(authorSigFile)) {
            fs.unlinkSync(authorSigFile)
        }
        let distributorSigFile1 = path.resolve(this.location, `signature1.xml`);
        if (fs.existsSync(distributorSigFile1)) {
            fs.unlinkSync(distributorSigFile1)
        }
        let distributorSigFile2 = path.resolve(this.location, `signature2.xml`);
        if (fs.existsSync(distributorSigFile2)) {
            fs.unlinkSync(distributorSigFile2)
        }
    }

    _getContentSrc() {
        let src = null;
        let configXml = path.resolve(this.location, `config.xml`);
        let orignalXml = fs.readFileSync(configXml, {encoding: 'utf-8'});
        xml2js.parseString(orignalXml, (err, jsonTemp) => {
            if (jsonTemp.widget.content == undefined) {
                return;
            }
            src = jsonTemp.widget.content[0].$.src;
        });

        return src ? path.resolve(this.location, src) : null;
    }

    init() {
        console.info('[webide-common-tizentv]projectHelper.init() start...');
        let configXml = path.resolve(this.location, `config.xml`);
        fs.readFile(configXml, (err, orignalXml) => {
            xml2js.parseString(orignalXml, (err, jsonTemp) => {
                if (jsonTemp.widget.name == undefined) {
                    jsonTemp.widget.name = new Array(this.name);
                }
                else {
                    jsonTemp.widget.name[0] = this.name;
                }

                if (jsonTemp.widget['tizen:application'] == undefined) {
                    jsonTemp.widget['tizen:application'] = new Array({
                        '$': {
                            'id': `${this.id}.${this.name}`,
                            'package' : `${this.id}`,
                            'required_version': '2.3'
                        }
                    });
                }
                else {
                    jsonTemp.widget['tizen:application'][0].$.id = `${this.id}.${this.name}`;
                    jsonTemp.widget['tizen:application'][0].$.package = `${this.id}`;
                }

                let builder = new xml2js.Builder();
                let newXml = builder.buildObject(jsonTemp);
                fs.writeFileSync(configXml, newXml);
            });
        });
    }

    buildWidget(profilePath, excludeFiles) {
        console.info('[webide-common-tizentv]projectHelper.buildWidget() start...');
        this._cleanFiles(true);
        let activeProfile = profileEditor.getActiveProfile(profilePath);
        if (activeProfile == null || activeProfile == '') {
            console.error('[webide-common-tizentv]projectHelper.buildWidget(): no active profile');
            throw 'no active profile!';
        }

        let pkgSigner = new PackageSigner();
        pkgSigner.setProfile(profilePath, activeProfile);
        pkgSigner.signPackage(this.location);

        let widget = fs.createWriteStream(path.resolve(this.location, `${this.name}.wgt`));
        let archive = archiver('zip');
        archive.pipe(widget);

        let rootPath = this.location;
        let wgtPath = path.resolve(rootPath, `${this.name}.wgt`);
        if (undefined == excludeFiles || null == excludeFiles || '' == excludeFiles) {
            excludeFiles = [wgtPath];
        } else {
            excludeFiles = excludeFiles + ',' + wgtPath;
            excludeFiles = excludeFiles.split(',');
        }

        let dirent = fs.readdirSync(rootPath, {withFileTypes: true});
        dirent.forEach(item => {
            if (!item.name.startsWith('.')) {
                let itemPath = path.resolve(rootPath, item.name);
                if (item.isDirectory()) {
                    if (!excludeFiles.includes(itemPath)) {
                        archive.directory(itemPath, item.name);
                    }
                } else {
                    if (!excludeFiles.includes(itemPath)) {
                        archive.append(fs.createReadStream(itemPath), {name: item.name});
                    }
                }
            }
        });

        archive.finalize();
        this._cleanFiles(false);
        return true;
    }

    launchOnSimulator(simulatorLocation) {
        console.info('[webide-common-tizentv]projectHelper.launchOnSimulator() start...');
        let contentSrc = this._getContentSrc();
        if (simulatorLocation == null) {
            console.error('[webide-common-tizentv]projectHelper.launchOnSimulator(): simulatorLocation is null!');
            return false;
        }

        let cmd = `${simulatorLocation} --file="file:///${contentSrc}"`;
        exec(cmd);
        return true;
    }

    async launchOnEmulator(chromeExecPath, isDebug) {
        console.info('[webide-common-tizentv]projectHelper.launchOnEmulator() start...');
        let launcher = new AppLauncher({
            projectPath: this.location,
            appID: `${this.id}.${this.name}`,
            device: 'emulator'
        });

        try {
            if (isDebug) {
                await launcher.checkChrome(chromeExecPath);
            }

            await launcher.checkEmulator();
            await launcher.pushWgt();
            await launcher.uninstallApp();
            await launcher.installApp();

            if (isDebug) {
                await launcher.debugApp();
                await launcher.setDebugPort();
                await launcher.openChromeDevTool(chromeExecPath);
            } else {
                await launcher.executeApp();
            }
        } catch(err) {
        		console.error('[webide-common-tizentv]projectHelper.launchOnEmulator() error =' + err);
            return false;
        }
        return true;
    }

    async launchOnTV(tvIP, chromeExecPath, isDebug) {
        console.info('[webide-common-tizentv]projectHelper.launchOnTV() start...');
        let launcher = new AppLauncher({
            projectPath: this.location,
            appID: `${this.id}.${this.name}`,
            device: tvIP
        });

        try {
            if (isDebug) {
                await launcher.checkChrome(chromeExecPath);
            }
            await launcher.connectTarget();
            await launcher.pushWgt();
            await launcher.uninstallApp();
            await launcher.installApp();

            if (isDebug) {
                await launcher.debugApp();
                await launcher.openChromeDevTool(chromeExecPath);
            } else {
                await launcher.executeApp();
            }
        } catch(err) {
            console.error('[webide-common-tizentv]projectHelper.launchOnTV() error =' + err);
            return false;
        }
        return true;
    }

    getAppScreenWidth() {
        let width = '0';
        let configXml = path.resolve(this.location, `config.xml`);
        let orignalXml = fs.readFileSync(configXml, {encoding: 'utf-8'});
        xml2js.parseString(orignalXml, (err, jsonTemp) => {
            if (jsonTemp.widget.feature == undefined) {
                return;
            }
            jsonTemp.widget.feature.forEach(feature => {
                if (feature.$.name.startsWith('http://tizen.org/feature/screen.size')) {
                    if (feature.$.name == 'http://tizen.org/feature/screen.size.all') {
                        width = '1920';
                    } else {
                        if (feature.$.name != 'http://tizen.org/feature/screen.size' && feature.$.name != 'http://tizen.org/feature/screen.size.normal') {
                            let curWidth = feature.$.name.split('.').pop().trim();
                            width = parseInt(width) > parseInt(curWidth) ? width : curWidth;
                        }
                    }
                }
            })
        });

        return width == '0' ? '1280' : width;
    }

    static openProject(projectPath) {
        let appObj = null;
        let configXml = path.resolve(projectPath, `config.xml`);
        if (fs.existsSync(configXml)) {
            let configData = fs.readFileSync(configXml);
            xml2js.parseString(configData, (err, jsonData) => {
                if (!err) {
                    if (jsonData.widget != undefined && jsonData.widget['tizen:application'] != undefined) {
                        let id = jsonData.widget['tizen:application'][0].$.package;
                        let name = jsonData.widget.name;

                        appObj = new TVWebApp(name, projectPath, id);
                    }
                }
            });
        }

        return appObj;
    }

    static getProjectId(projectPath) {
        let appId = '';
        let configXml = path.resolve(projectPath, `config.xml`);
        if (fs.existsSync(configXml)) {
            let configData = fs.readFileSync(configXml);
            xml2js.parseString(configData, (err, jsonData) => {
                if (!err) {
                    if (jsonData.widget != undefined && jsonData.widget['tizen:application'] != undefined) {
                        appId = jsonData.widget['tizen:application'][0].$.id;
                    }
                }
            });
        }

        return appId;
    }
}
