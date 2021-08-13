'use strict';
const joi = require('joi');
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

function Netplan(config) {
    const schema = joi.object({
        network: joi.object({
            version: joi.number().default(2),
            renderer: joi.string().valid('networkd', 'NetworkManager').default('networkd'),
            ethernets: joi.object().optional(), // This can be defined later
            wifis: joi.object().optional() // This can be defined later
        }).default(),
        configFile: joi.string().regex(/^(\/[^\/ ]*)+\/?$/).default('/etc/netplan/config.yaml')
    });
    const input = config || {};
    const validated = joi.attempt(input, schema);
    this.plan = {
        network: validated.network
    };
    this.configFile = validated.configFile;

    // Accommodate /sbin and /usr/sbin in path
    let paths = new Set(process.env.PATH.split(':'));
    paths.add('/sbin');
    paths.add('/usr/sbin')

    this.binary = null;
    paths.forEach(binPath => {
        if (fs.existsSync(path.join(binPath, 'netplan'))) {
            this.binary = path.join(binPath, 'netplan');
        }
    });
}

/*
 * Load the current configuration file
 */
Netplan.prototype.loadConfig = function() {
    if (fs.existsSync(this.configFile)) {
        const contents = fs.readFileSync(this.configFile, 'utf8');
        this.plan = yaml.parse(contents);
    }
};

/*
 * Write current config to netplan config file
 */
Netplan.prototype.writeConfig = function() {
    const yamlDoc = new yaml.Document();
    yamlDoc.contents = this.plan;

    // Write this to the configuration file
    fs.writeFileSync(this.configFile, yamlDoc.toString());
}

/*
 * Provide custom interface config using the netplan format
 */
Netplan.prototype.configureNetplanInterface = function(options) {
    const schema = joi.object({
        name: joi.string().min(1).required(),
        type: joi.string().valid('ethernet', 'wifi').default('ethernet'),
        definition: joi.object().required()
    });
    let validated = joi.attempt(options, schema);

    if (validated.type === 'ethernet') {
        this.plan.network.ethernets = this.plan.network.ethernets || {};
        this.plan.network.ethernets[validated.name] = validated.definition;
    } else if (validated.type === 'wifi') {
        this.plan.network.wifis = validated.wifis || {};
        this.plan.network.wifis[validated.name] = validated.definition;
    } else {
        throw new Error(`Unsupported interface type: ${validated.type}`);
    }
};

/*
 * The following are some easy-to-use prepackaged methods for configuring typical network interfaces
 */
function addAccessPoint(definition, accessPoint) {
    definition['access-points'] = {};
    definition['access-points'][accessPoint.ssid] = {
        password: accessPoint.wifiPassword
    };
}

Netplan.prototype.configureInterface = function(name, options) {
    const schema = joi.object({
        dhcp: joi.boolean().default(false),
        ip: joi.string().ip().optional(),
        prefix: joi.number().min(0).max(32).default(24),
        defaultGateway: joi.string().ip().optional(),
        domain: joi.string().domain().optional(),
        nameservers: joi.array().items(joi.string().ip()).optional(),
        accessPoint: joi.object({
            ssid: joi.string().min(1).required(),
            wifiPassword: joi.string().min(1).required()
        }).optional()
    });
    const validated = joi.attempt(options, schema);

    let definition = {
        ...validated.dhcp && {dhcp4: 'yes'},
        ...(!validated.dhcp && validated.ip) && {addresses: [`${validated.ip}/${validated.prefix}`]},
        ...(!validated.dhcp && validated.nameservers) && {
            nameservers: {
                ...validated.domain && {search: [validated.domain]},
                addresses: validated.nameservers
            }
        },
        ...(!validated.dhcp && validated.defaultGateway) && {
            routes: [
                {
                    to: '0.0.0.0/0',
                    via: validated.defaultGateway
                }
            ]
        }
    }

    let type = 'ethernet';
    if (validated.accessPoint) {
        addAccessPoint(definition, validated.accessPoint);
        type = 'wifi';
    }

    this.configureNetplanInterface({
        name,
        type,
        definition
    });
};

/*
 * Netplan execution method
 */
Netplan.prototype.executeBinary = function(args) {
    const netplan = this;
    return new Promise(function(resolve, reject) {
        if (!netplan.binary) {
            return reject(new Error('netplan binary not found'));
        }
        const netplanResult = spawn(netplan.binary, args);
        const result = {};

        netplanResult.stdout.on('data', (data) => {
            result.stdout = data.toString('utf8').trim();
        });

        netplanResult.stderr.on('data', (data) => {
            result.stderr = data.toString('utf8').trim();
        });

        netplanResult.on('close', (code) => {
            result.code = code;
            if (code !== 0) {
                let error = new Error(`netplan failed with code ${code} using args args '${args}'`);
                error.stdout = result.stdout;
                error.stderr = result.stderr;
                error.code = code;
                return reject(error);
            } else {
                return resolve(result);
            }
        });
    });
};

/*
 * Generate backend configs
 */
Netplan.prototype.apply = function() {
    return this.executeBinary(['generate']);
};

/*
 * Apply the changes
 */
Netplan.prototype.apply = function() {
    return this.executeBinary(['apply']);
};

module.exports = Netplan;
