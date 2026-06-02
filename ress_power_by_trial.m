function [trialPower, spatialFilter, component, details] = ress_power_by_trial(eeg, fs, targetFreq, varargin)
%RESS_POWER_BY_TRIAL Trial-wise rhythmic entrainment power using RESS.
%
%   [trialPower, spatialFilter, component, details] = ...
%       ress_power_by_trial(eeg, fs, targetFreq)
%
%   Inputs
%   ------
%   eeg        : channels x time points x trials EEG data.
%                For your first use case this is 32 x 10000 x 3.
%                A channels x time points matrix is treated as one trial.
%   fs         : sampling rate in Hz.
%   targetFreq : stimulation/entrainment frequency in Hz.
%
%   Outputs
%   -------
%   trialPower    : trials x 1 power estimates at targetFreq.
%   spatialFilter : channels x 1 RESS spatial filter.
%   component     : time points x trials RESS component time series.
%   details       : struct with eigenvalues, covariance matrices, and
%                   analysis settings.
%
%   Method
%   ------
%   This follows the core RESS/Cohen recipe:
%     1. Narrow-band filter EEG at targetFreq, concatenate trials, and
%        compute signal covariance.
%     2. Narrow-band filter EEG at neighboring frequencies and compute
%        reference covariance from the concatenated trials.
%     3. Solve signalCov * w = lambda * referenceCov * w.
%     4. Project EEG through the leading eigenvector w.
%     5. Estimate each trial's spectral power at targetFreq.
%
%   Name-value options
%   ------------------
%   'SignalFWHM'       : Gaussian target filter FWHM in Hz. Default: 0.5
%   'ReferenceOffset'  : Neighboring reference offset in Hz. Default: 1
%   'ReferenceFWHM'    : Gaussian reference filter FWHM in Hz. Default: 1
%   'Regularization'   : Diagonal loading fraction for reference covariance.
%                        Default: 1e-8
%   'Demean'           : Remove each channel's time mean per trial before
%                        filtering/projection. Default: true

parser = inputParser;
parser.FunctionName = mfilename;
addParameter(parser, 'SignalFWHM', 0.5, @is_positive_scalar);
addParameter(parser, 'ReferenceOffset', 1, @is_positive_scalar);
addParameter(parser, 'ReferenceFWHM', 1, @is_positive_scalar);
addParameter(parser, 'Regularization', 1e-8, @is_nonnegative_scalar);
addParameter(parser, 'Demean', true, @(x) islogical(x) || isnumeric(x));
parse(parser, varargin{:});
opts = parser.Results;
opts.Demean = logical(opts.Demean);

if ~isnumeric(eeg) || ndims(eeg) > 3
    error('eeg must be a numeric channels x time points x trials array, or channels x time points for one trial.');
end

if ~is_positive_scalar(fs)
    error('fs must be a positive scalar sampling rate in Hz.');
end

if ~is_positive_scalar(targetFreq)
    error('targetFreq must be a positive scalar frequency in Hz.');
end

[nChannels, nTime, nTrials] = size(eeg);
eeg = reshape(eeg, nChannels, nTime, nTrials);
nyquist = fs / 2;
lowerRefFreq = targetFreq - opts.ReferenceOffset;
upperRefFreq = targetFreq + opts.ReferenceOffset;

if targetFreq >= nyquist
    error('targetFreq must be below the Nyquist frequency, fs/2.');
end

if lowerRefFreq <= 0
    error('targetFreq - ReferenceOffset must be greater than 0 Hz.');
end

if upperRefFreq >= nyquist
    error('targetFreq + ReferenceOffset must be below the Nyquist frequency, fs/2.');
end

eeg = double(eeg);
if any(~isfinite(eeg(:)))
    error('eeg contains NaN or Inf values. Clean or interpolate them before RESS.');
end

if opts.Demean
    eeg = bsxfun(@minus, eeg, mean(eeg, 2));
end

targetFiltered = gaussian_bandpass_fft(eeg, fs, targetFreq, opts.SignalFWHM);
lowerRefFiltered = gaussian_bandpass_fft(eeg, fs, lowerRefFreq, opts.ReferenceFWHM);
upperRefFiltered = gaussian_bandpass_fft(eeg, fs, upperRefFreq, opts.ReferenceFWHM);

targetTrainingData = concatenate_trials(targetFiltered);
lowerRefTrainingData = concatenate_trials(lowerRefFiltered);
upperRefTrainingData = concatenate_trials(upperRefFiltered);

signalCov = covariance_over_columns(targetTrainingData);
lowerRefCov = covariance_over_columns(lowerRefTrainingData);
upperRefCov = covariance_over_columns(upperRefTrainingData);
referenceCov = (lowerRefCov + upperRefCov) / 2;

covScale = trace(referenceCov) / nChannels;
if covScale <= 0 || ~isfinite(covScale)
    covScale = 1;
end
referenceCovReg = referenceCov + eye(nChannels) * opts.Regularization * covScale;

[eigenvectors, eigenvaluesMatrix] = eig(signalCov, referenceCovReg);
eigenvalues = real(diag(eigenvaluesMatrix));
[eigenvalues, order] = sort(eigenvalues, 'descend');
eigenvectors = real(eigenvectors(:, order));

spatialFilter = eigenvectors(:, 1);
spatialFilter = spatialFilter / norm(spatialFilter);

% Eigenvector signs are arbitrary. Use the component map to choose a stable
% sign convention where the largest map weight is positive.
componentMap = signalCov * spatialFilter / (spatialFilter' * signalCov * spatialFilter);
[~, maxMapChannel] = max(abs(componentMap));
if componentMap(maxMapChannel) < 0
    spatialFilter = -spatialFilter;
    componentMap = -componentMap;
end

eegConcatenated = concatenate_trials(eeg);
component = reshape(spatialFilter' * eegConcatenated, nTime, nTrials);

time = (0:(nTime - 1)) / fs;
fourierBasis = exp(-1i * 2 * pi * targetFreq * time);
fourierAmplitude = (2 / nTime) * (fourierBasis * component);

% Single-frequency RMS power. For a pure sine wave, this is half the squared
% peak amplitude of the RESS component at targetFreq.
trialPower = (abs(fourierAmplitude(:)) .^ 2) / 2;

details = struct();
details.targetFreq = targetFreq;
details.fs = fs;
details.signalFWHM = opts.SignalFWHM;
details.referenceFreqs = [lowerRefFreq upperRefFreq];
details.referenceFWHM = opts.ReferenceFWHM;
details.referenceOffset = opts.ReferenceOffset;
details.regularization = opts.Regularization;
details.nTrials = nTrials;
details.trainingDataSize = size(targetTrainingData);
details.eigenvalues = eigenvalues;
details.componentMap = componentMap;
details.signalCov = signalCov;
details.referenceCov = referenceCov;
details.referenceCovReg = referenceCovReg;
details.fourierAmplitude = fourierAmplitude(:);

end

function filtered = gaussian_bandpass_fft(data, fs, centerFreq, fwhm)
[~, nTime, ~] = size(data);
sigma = fwhm / (2 * sqrt(2 * log(2)));

freqAxis = (0:(nTime - 1)) * (fs / nTime);
freqAxis(freqAxis > fs / 2) = freqAxis(freqAxis > fs / 2) - fs;

kernel = exp(-0.5 * ((abs(freqAxis) - centerFreq) / sigma) .^ 2);
kernel = reshape(kernel, 1, nTime, 1);

filtered = real(ifft(bsxfun(@times, fft(data, [], 2), kernel), [], 2));
end

function concatenated = concatenate_trials(data)
[nChannels, ~, ~] = size(data);
concatenated = reshape(data, nChannels, []);
end

function covMatrix = covariance_over_columns(channelByObservation)
channelByObservation = bsxfun(@minus, channelByObservation, mean(channelByObservation, 2));
covMatrix = (channelByObservation * channelByObservation') / (size(channelByObservation, 2) - 1);
covMatrix = (covMatrix + covMatrix') / 2;
end

function tf = is_positive_scalar(x)
tf = isnumeric(x) && isscalar(x) && isfinite(x) && x > 0;
end

function tf = is_nonnegative_scalar(x)
tf = isnumeric(x) && isscalar(x) && isfinite(x) && x >= 0;
end
