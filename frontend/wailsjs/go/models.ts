export namespace backend {
	
	export class DisplaySize {
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new DisplaySize(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class HttpExtra {
	    id: number;
	    uid: string;
	    reqTime: number;
	    respTime: number;
	
	    static createFrom(source: any = {}) {
	        return new HttpExtra(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.uid = source["uid"];
	        this.reqTime = source["reqTime"];
	        this.respTime = source["respTime"];
	    }
	}
	export class NetworkRequest {
	    id: string;
	    timestamp: number;
	    method: string;
	    url: string;
	    fullUrl?: string;
	    statusCode?: number;
	    requestHeaders?: Record<string, string>;
	    responseHeaders?: Record<string, string>;
	    requestBody?: string;
	    responseBody?: string;
	    rawData?: string;
	    direction: string;
	    extra?: HttpExtra;
	    requestParams?: Record<string, any>;
	    baseURL?: string;
	    isSessionBoundary?: boolean;
	    boundaryType?: string;
	    clientId?: string;
	    boundaryMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new NetworkRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.timestamp = source["timestamp"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.fullUrl = source["fullUrl"];
	        this.statusCode = source["statusCode"];
	        this.requestHeaders = source["requestHeaders"];
	        this.responseHeaders = source["responseHeaders"];
	        this.requestBody = source["requestBody"];
	        this.responseBody = source["responseBody"];
	        this.rawData = source["rawData"];
	        this.direction = source["direction"];
	        this.extra = this.convertValues(source["extra"], HttpExtra);
	        this.requestParams = source["requestParams"];
	        this.baseURL = source["baseURL"];
	        this.isSessionBoundary = source["isSessionBoundary"];
	        this.boundaryType = source["boundaryType"];
	        this.clientId = source["clientId"];
	        this.boundaryMessage = source["boundaryMessage"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PortForwardItem {
	    localPort: number;
	    devicePort: number;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new PortForwardItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.localPort = source["localPort"];
	        this.devicePort = source["devicePort"];
	        this.type = source["type"];
	    }
	}
	export class PortForwardStatus {
	    configured: boolean;
	    localPort: number;
	    devicePort: number;
	    status: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new PortForwardStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.configured = source["configured"];
	        this.localPort = source["localPort"];
	        this.devicePort = source["devicePort"];
	        this.status = source["status"];
	        this.error = source["error"];
	    }
	}

}

export namespace hdc {
	
	export class AppInfo {
	    packageName: string;
	    appName: string;
	    version: string;
	    versionCode: number;
	    size: number;
	    icon: string;
	    isSystemApp: boolean;
	    isRunning: boolean;
	    isEnabled: boolean;
	    installTime: number;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.packageName = source["packageName"];
	        this.appName = source["appName"];
	        this.version = source["version"];
	        this.versionCode = source["versionCode"];
	        this.size = source["size"];
	        this.icon = source["icon"];
	        this.isSystemApp = source["isSystemApp"];
	        this.isRunning = source["isRunning"];
	        this.isEnabled = source["isEnabled"];
	        this.installTime = source["installTime"];
	    }
	}
	export class AppStats {
	    total: number;
	    system: number;
	    thirdParty: number;
	    running: number;
	
	    static createFrom(source: any = {}) {
	        return new AppStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.system = source["system"];
	        this.thirdParty = source["thirdParty"];
	        this.running = source["running"];
	    }
	}
	export class AppListResult {
	    stats: AppStats;
	    apps: AppInfo[];
	
	    static createFrom(source: any = {}) {
	        return new AppListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stats = this.convertValues(source["stats"], AppStats);
	        this.apps = this.convertValues(source["apps"], AppInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class BatteryInfo {
	    capacity: number;
	    temperature: number;
	    voltage: number;
	    chargingStatus: string;
	    pluggedType: string;
	    technology: string;
	    health: string;
	
	    static createFrom(source: any = {}) {
	        return new BatteryInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.capacity = source["capacity"];
	        this.temperature = source["temperature"];
	        this.voltage = source["voltage"];
	        this.chargingStatus = source["chargingStatus"];
	        this.pluggedType = source["pluggedType"];
	        this.technology = source["technology"];
	        this.health = source["health"];
	    }
	}
	export class CpuDetailInfo {
	    total: number;
	    user: number;
	    system: number;
	    kernel: number;
	    idle: number;
	    iowait: number;
	    irq: number;
	    // Go type: struct { One float64 "json:\"one\""; Five float64 "json:\"five\""; Fifteen float64 "json:\"fifteen\"" }
	    loadAverage: any;
	
	    static createFrom(source: any = {}) {
	        return new CpuDetailInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.user = source["user"];
	        this.system = source["system"];
	        this.kernel = source["kernel"];
	        this.idle = source["idle"];
	        this.iowait = source["iowait"];
	        this.irq = source["irq"];
	        this.loadAverage = this.convertValues(source["loadAverage"], Object);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CpuUsageInfo {
	    usagePercent: number;
	    user: number;
	    system: number;
	    idle: number;
	
	    static createFrom(source: any = {}) {
	        return new CpuUsageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.usagePercent = source["usagePercent"];
	        this.user = source["user"];
	        this.system = source["system"];
	        this.idle = source["idle"];
	    }
	}
	export class DeviceDetailInfo {
	    productName: string;
	    model: string;
	    brand: string;
	    manufacturer: string;
	    deviceType: string;
	    serialNumber: string;
	    osName: string;
	    osVersion: string;
	    apiVersion: string;
	    softwareVersion: string;
	    ohosFullName: string;
	    securityPatch: string;
	    kernelVersion: string;
	    cpuAbi: string;
	    hardwareVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new DeviceDetailInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.productName = source["productName"];
	        this.model = source["model"];
	        this.brand = source["brand"];
	        this.manufacturer = source["manufacturer"];
	        this.deviceType = source["deviceType"];
	        this.serialNumber = source["serialNumber"];
	        this.osName = source["osName"];
	        this.osVersion = source["osVersion"];
	        this.apiVersion = source["apiVersion"];
	        this.softwareVersion = source["softwareVersion"];
	        this.ohosFullName = source["ohosFullName"];
	        this.securityPatch = source["securityPatch"];
	        this.kernelVersion = source["kernelVersion"];
	        this.cpuAbi = source["cpuAbi"];
	        this.hardwareVersion = source["hardwareVersion"];
	    }
	}
	export class DeviceInfo {
	    productName: string;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new DeviceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.productName = source["productName"];
	        this.model = source["model"];
	    }
	}
	export class GraphicsInfo {
	    gpuVendor: string;
	    gpuRenderer: string;
	    gpuVersion: string;
	    surfaceMemory: number;
	    // Go type: struct { Fps60 int "json:\"fps60\""; Fps90 int "json:\"fps90\""; Fps120 int "json:\"fps120\"" }
	    fpsCount: any;
	
	    static createFrom(source: any = {}) {
	        return new GraphicsInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gpuVendor = source["gpuVendor"];
	        this.gpuRenderer = source["gpuRenderer"];
	        this.gpuVersion = source["gpuVersion"];
	        this.surfaceMemory = source["surfaceMemory"];
	        this.fpsCount = this.convertValues(source["fpsCount"], Object);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HapAppInfo {
	    filePath: string;
	    fileSize: number;
	    extractedHapPath?: string;
	    appName: string;
	    icon?: string;
	    layeredIcon?: Record<string, string>;
	    bundleName: string;
	    versionName: string;
	    versionCode: number;
	    vendor: string;
	    moduleName: string;
	    moduleDescription?: string;
	    minAPIVersion?: number;
	    targetAPIVersion?: number;
	    compileSdkVersion?: string;
	    compileMode?: string;
	    virtualMachine?: string;
	    deviceTypes?: string[];
	    permissions: any[];
	    abilities: any[];
	
	    static createFrom(source: any = {}) {
	        return new HapAppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.fileSize = source["fileSize"];
	        this.extractedHapPath = source["extractedHapPath"];
	        this.appName = source["appName"];
	        this.icon = source["icon"];
	        this.layeredIcon = source["layeredIcon"];
	        this.bundleName = source["bundleName"];
	        this.versionName = source["versionName"];
	        this.versionCode = source["versionCode"];
	        this.vendor = source["vendor"];
	        this.moduleName = source["moduleName"];
	        this.moduleDescription = source["moduleDescription"];
	        this.minAPIVersion = source["minAPIVersion"];
	        this.targetAPIVersion = source["targetAPIVersion"];
	        this.compileSdkVersion = source["compileSdkVersion"];
	        this.compileMode = source["compileMode"];
	        this.virtualMachine = source["virtualMachine"];
	        this.deviceTypes = source["deviceTypes"];
	        this.permissions = source["permissions"];
	        this.abilities = source["abilities"];
	    }
	}
	export class HdcDevice {
	    connectKey: string;
	    connectionType: string;
	    status: string;
	    deviceName?: string;
	    productName?: string;
	    model?: string;
	    displayName?: string;
	
	    static createFrom(source: any = {}) {
	        return new HdcDevice(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectKey = source["connectKey"];
	        this.connectionType = source["connectionType"];
	        this.status = source["status"];
	        this.deviceName = source["deviceName"];
	        this.productName = source["productName"];
	        this.model = source["model"];
	        this.displayName = source["displayName"];
	    }
	}
	export class HdcResult {
	    success: boolean;
	    output: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new HdcResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.output = source["output"];
	        this.error = source["error"];
	    }
	}
	export class MemoryDetailInfo {
	    total: number;
	    used: number;
	    free: number;
	    available: number;
	    cached: number;
	    buffers: number;
	    swapTotal: number;
	    swapUsed: number;
	    swapFree: number;
	    usedPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new MemoryDetailInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.used = source["used"];
	        this.free = source["free"];
	        this.available = source["available"];
	        this.cached = source["cached"];
	        this.buffers = source["buffers"];
	        this.swapTotal = source["swapTotal"];
	        this.swapUsed = source["swapUsed"];
	        this.swapFree = source["swapFree"];
	        this.usedPercent = source["usedPercent"];
	    }
	}
	export class MemoryInfo {
	    total: number;
	    free: number;
	    available: number;
	    cached: number;
	    usedPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new MemoryInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.free = source["free"];
	        this.available = source["available"];
	        this.cached = source["cached"];
	        this.usedPercent = source["usedPercent"];
	    }
	}
	export class NetworkInfo {
	    interface: string;
	    ipAddress: string;
	    macAddress: string;
	    netmask: string;
	
	    static createFrom(source: any = {}) {
	        return new NetworkInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.interface = source["interface"];
	        this.ipAddress = source["ipAddress"];
	        this.macAddress = source["macAddress"];
	        this.netmask = source["netmask"];
	    }
	}
	export class NetworkTrafficInfo {
	    interface: string;
	    rxBytes: number;
	    txBytes: number;
	    rxPackets: number;
	    txPackets: number;
	
	    static createFrom(source: any = {}) {
	        return new NetworkTrafficInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.interface = source["interface"];
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	        this.rxPackets = source["rxPackets"];
	        this.txPackets = source["txPackets"];
	    }
	}
	export class OnlineAppInfo {
	    name: string;
	    icon: string;
	
	    static createFrom(source: any = {}) {
	        return new OnlineAppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.icon = source["icon"];
	    }
	}
	export class ProcessInfo {
	    pid: number;
	    user: string;
	    priority: number;
	    nice: number;
	    virt: string;
	    res: string;
	    shr: string;
	    state: string;
	    cpuPercent: number;
	    memPercent: number;
	    time: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ProcessInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.user = source["user"];
	        this.priority = source["priority"];
	        this.nice = source["nice"];
	        this.virt = source["virt"];
	        this.res = source["res"];
	        this.shr = source["shr"];
	        this.state = source["state"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memPercent = source["memPercent"];
	        this.time = source["time"];
	        this.command = source["command"];
	    }
	}
	export class ProcessStats {
	    total: number;
	    running: number;
	    sleeping: number;
	    stopped: number;
	    zombie: number;
	
	    static createFrom(source: any = {}) {
	        return new ProcessStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.running = source["running"];
	        this.sleeping = source["sleeping"];
	        this.stopped = source["stopped"];
	        this.zombie = source["zombie"];
	    }
	}
	export class ProcessListResult {
	    stats: ProcessStats;
	    processes: ProcessInfo[];
	
	    static createFrom(source: any = {}) {
	        return new ProcessListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stats = this.convertValues(source["stats"], ProcessStats);
	        this.processes = this.convertValues(source["processes"], ProcessInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class StorageInfo {
	    total: string;
	    used: string;
	    available: string;
	    usedPercent: number;
	    mountPoint: string;
	
	    static createFrom(source: any = {}) {
	        return new StorageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.used = source["used"];
	        this.available = source["available"];
	        this.usedPercent = source["usedPercent"];
	        this.mountPoint = source["mountPoint"];
	    }
	}
	export class SystemRuntime {
	    uptime: string;
	    loadAverage: string;
	    currentTime: string;
	
	    static createFrom(source: any = {}) {
	        return new SystemRuntime(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.uptime = source["uptime"];
	        this.loadAverage = source["loadAverage"];
	        this.currentTime = source["currentTime"];
	    }
	}

}

export namespace phoneAgent {
	
	export class LLMConfig {
	    provider: string;
	    apiKey: string;
	    baseURL: string;
	    model: string;
	    maxTokens: number;
	    temperature: number;
	    topP: number;
	
	    static createFrom(source: any = {}) {
	        return new LLMConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.apiKey = source["apiKey"];
	        this.baseURL = source["baseURL"];
	        this.model = source["model"];
	        this.maxTokens = source["maxTokens"];
	        this.temperature = source["temperature"];
	        this.topP = source["topP"];
	    }
	}
	export class AgentConfig {
	    maxSteps: number;
	    deviceID: string;
	    platform: string;
	    llmConfig: LLMConfig;
	    language: string;
	    systemPrompt: string;

	    static createFrom(source: any = {}) {
	        return new AgentConfig(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxSteps = source["maxSteps"];
	        this.deviceID = source["deviceID"];
	        this.platform = source["platform"];
	        this.llmConfig = this.convertValues(source["llmConfig"], LLMConfig);
	        this.language = source["language"];
	        this.systemPrompt = source["systemPrompt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

