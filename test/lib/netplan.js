'use strict';

const mockSpawn = require('mock-spawn');
const mySpawn = mockSpawn();
require('child_process').spawn = mySpawn;
const NetPlan = require('../../index');
const expect = require('chai').expect;
const assert = require('chai').assert;
const fs = require('fs');

const testData = {
	oneStaticEth:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/1StaticEth.json`, 'utf8')),
	oneDhcpEth:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/1DhcpEth.json`, 'utf8')),
	oneStaticEthInterface:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/StaticEthInterface.json`, 'utf8')),
	oneStaticEthInterfaceNoGateway:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/StaticEthInterfaceNoGateway.json`, 'utf8')),
	oneStaticEthOneDhcpWifi:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/1StaticEth1DhcpWifi.json`, 'utf8')),
	oneDhcpWifiInterface:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/DhcpWifiInterface.json`, 'utf8')),
	oneStaticEthNoGatewayOneStaticWifi:
		JSON.parse(fs.readFileSync(`${__dirname}/../data/1StaticEthNoGateway1StaticWifi.json`, 'utf8'))
};

async function expectError(fn) {
	let error = null;
	try {
		await fn()
	} catch (thrown) {
		error = thrown;
	}
	assert(error !== null);
}

describe('/lib/netplan', function() {

    describe('constructor', function() {
    	it('defaults', function(done) {
			const netplan = new NetPlan();
			expect(netplan.plan).not.undefined;
			done();
		});

		it('valid', function(done) {
			const netplan = new NetPlan(testData.oneStaticEth);
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEth, null, 2));
			done();
		});

		it('invalid', function(done) {
			try {
				new NetPlan({
					network: 'somestring'
				});
				done(new Error('should have thrown joi error'));
			} catch (err) {
				done();
			}
		});
    });

	describe('loadConfig', function() {
		it('valid', function(done) {
			const netplan = new NetPlan({
				configFile: `${__dirname}/../data/1StaticEth.yaml`
			});
			netplan.loadConfig();
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEth, null, 2));
			done();
		});

		it('no file', function(done) {
			const netplan = new NetPlan({
				configFile: '/invalid/file'
			});
			const before = JSON.stringify(netplan.plan, null, 2);
			netplan.loadConfig();
			const after = JSON.stringify(netplan.plan, null, 2);
			expect(before).eql(after);
			done();
		});
	});

    describe('configureNetplanInterface', function() {
		it('valid ethernet static', function(done) {
			const netplan = new NetPlan({
				configFile: '/tmp/netplan.yaml'
			});
			netplan.configureNetplanInterface(testData.oneStaticEthInterface);
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEth, null, 2));
			done();
		});

		it('valid wifi dhcp', function(done) {
			const netplan = new NetPlan({
				configFile: '/tmp/netplan.yaml'
			});
			netplan.configureNetplanInterface(testData.oneStaticEthInterfaceNoGateway);
			netplan.configureNetplanInterface(testData.oneDhcpWifiInterface);
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEthOneDhcpWifi, null, 2));
			done();
		});
    });

	describe('configureInterface', function() {
		it('valid ethernet static', function(done) {
			const netplan = new NetPlan({
				configFile: '/tmp/netplan.yaml'
			});
			netplan.configureInterface('eth0', {
				dhcp: false,
				ip: '192.168.4.8',
				defaultGateway: '192.168.4.1',
				nameservers: ['192.168.4.1'],
				domain: 'guardian-angel.local'
			});
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEth, null, 2));
			// TODO: test configureInterface
			done();
		});

		it('valid wifi static', function(done) {
			const netplan = new NetPlan({
				configFile: '/tmp/netplan.yaml'
			});
			netplan.configureInterface('eth0', {
				dhcp: false,
				ip: '192.168.4.8'
			});
			netplan.configureInterface('wlan0', {
				dhcp: false,
				type: 'wifi',
				ip: '10.54.1.120',
				nameservers: ['10.54.1.1'],
				defaultGateway: '10.54.1.1',
				accessPoint: {
					ssid: 'TellMyWiFiLoveHer',
					wifiPassword: 'supersecretpassword'
				}
			})
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEthNoGatewayOneStaticWifi, null, 2));
			// TODO: test configureInterface
			done();
		});

		it('valid ethernet dhcp', function(done) {
			const netplan = new NetPlan({
				configFile: '/tmp/netplan.yaml'
			});
			netplan.configureInterface('eth0', {
				dhcp: true,
				type: 'ethernet'
			});
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneDhcpEth, null, 2));
			// TODO: test configureInterface
			done();
		});

		it('valid wifi dhcp', function(done) {
			const netplan = new NetPlan({
				configFile: '/tmp/netplan.yaml'
			});
			netplan.configureInterface('eth0', {
				dhcp: false,
				type: 'ethernet',
				ip: '192.168.4.8'
			});
			netplan.configureInterface('wlan0', {
				type: 'wifi',
				accessPoint: {
					ssid: 'TellMyWiFiLoveHer',
					wifiPassword: 'supersecretpassword'
				}
			});
			expect(
				JSON.stringify(netplan.plan, null, 2)
			).eql(JSON.stringify(testData.oneStaticEthOneDhcpWifi, null, 2));
			// TODO: test configureInterface
			done();
		});
	});

    describe('apply', function() {
    	it('success', function(done) {
    		let code = 0;
    		let stdout = '';
    		let stderr = '';
    		mySpawn.setDefault(mySpawn.simple(code, stdout, stderr));

    		const netplan = new NetPlan();
    		netplan.binary = '/usr/sbin/netplan';

    		netplan.apply().then(result => {
    			expect(result.code).eql(code);
    			done();
			}).catch(err => {
				done(err);
			});
		});

    	it('failure', function(done) {
    		let code = -1;
    		let stdout = '';
    		let stderr = 'some horrific stack trace';
    		mySpawn.setDefault(mySpawn.simple(code, stdout, stderr));

    		const netplan = new NetPlan();
    		netplan.binary = '/usr/sbin/netplan';

    		netplan.apply().then(result => {
    			done(new Error(`Test failed; expected error but got ${JSON.stringify(result)}`));
			}).catch(err => {
				expect(err.code).eql(code);
				done();
			});
		});

		it('no binary', function(done) {
			let code = -1;
			let stdout = '';
			let stderr = 'some horrific stack trace';
			mySpawn.setDefault(mySpawn.simple(code, stdout, stderr));

			const netplan = new NetPlan();

			netplan.apply().then(result => {
				done(new Error(`Test failed; expected error but got ${JSON.stringify(result)}`));
			}).catch(err => {
				done();
			});
		});
	});
    
});
