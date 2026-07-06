BUILD       := proof-source
WEB_PUBLIC  := ../apps/web/public/zkeys
CONTRACTS   := ../contracts/contracts
CIRCUIT     := privacyProof

c-com:
	mkdir -p $(BUILD)
	mkdir -p $(WEB_PUBLIC)
	circom $(CIRCUIT).circom --r1cs --wasm --sym -o $(BUILD)

c-p1:
	snarkjs powersoftau new bn128 15 $(BUILD)/pot15_0000.ptau -v

c-p2:
	snarkjs powersoftau contribute $(BUILD)/pot15_0000.ptau $(BUILD)/pot15_final.ptau --name="zhieldwrap-contributor" -v

c-final:
	snarkjs powersoftau prepare phase2 $(BUILD)/pot15_final.ptau $(BUILD)/pot15_final_phase2.ptau

zkey:
	snarkjs groth16 setup $(BUILD)/$(CIRCUIT).r1cs $(BUILD)/pot15_final_phase2.ptau $(BUILD)/$(CIRCUIT).zkey

vkey:
	snarkjs zkey export verificationkey $(BUILD)/$(CIRCUIT).zkey $(BUILD)/verification_key.json

gen-con:
	snarkjs zkey export solidityverifier $(BUILD)/$(CIRCUIT).zkey $(CONTRACTS)/ZKVerifier.sol
	sed -i '' 's/contract Groth16Verifier/contract ZKVerifier/' $(CONTRACTS)/ZKVerifier.sol

copy-web:
	cp $(BUILD)/$(CIRCUIT)_js/$(CIRCUIT).wasm $(WEB_PUBLIC)/$(CIRCUIT).wasm
	cp $(BUILD)/$(CIRCUIT).zkey               $(WEB_PUBLIC)/$(CIRCUIT).zkey

c-full:
	make c-com && make c-p1 && make c-p2 && make c-final && make zkey && make vkey && make gen-con && make copy-web
