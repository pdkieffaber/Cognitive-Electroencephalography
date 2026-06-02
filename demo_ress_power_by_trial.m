% Demo for ress_power_by_trial.m using synthetic 32 x 10000 x 3 EEG data.

rng(1);

fs = 1000;
targetFreq = 12;
nChannels = 32;
nTime = 10000;
nTrials = 3;
time = (0:(nTime - 1)) / fs;

sourceMap = randn(nChannels, 1);
sourceMap = sourceMap / norm(sourceMap);

trialAmplitudes = [1.0 0.6 1.4];
trialPhases = [0 0.8 1.5];

eeg = 2.5 * randn(nChannels, nTime, nTrials);
for trialIdx = 1:nTrials
    sourceSignal = trialAmplitudes(trialIdx) * ...
        sin(2 * pi * targetFreq * time + trialPhases(trialIdx));
    eeg(:, :, trialIdx) = eeg(:, :, trialIdx) + sourceMap * sourceSignal;
end

[trialPower, spatialFilter, component, details] = ...
    ress_power_by_trial(eeg, fs, targetFreq);

disp('Trial-wise RESS power:');
disp(trialPower);

disp('Leading generalized eigenvalue:');
disp(details.eigenvalues(1));

oneTrialPower = ress_power_by_trial(eeg(:, :, 1), fs, targetFreq);
disp('One-trial RESS power smoke check:');
disp(oneTrialPower);

figure;
bar(trialPower);
xlabel('Trial');
ylabel('RESS power at target frequency');
title(sprintf('RESS power at %.2f Hz', targetFreq));
